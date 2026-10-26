-- Purpose: proves the compliance registry (migrations 20261023120000..200) from pg_catalog and by behaviour, as each role.
-- Run: `npm run test:compliance` (local stack only; needs the seed: example.test users). It runs in ONE transaction and
-- ROLLS BACK, so it leaves no data behind. Fictional names only. Prints "COMPLIANCE REGISTRY CHECK PASSED" or fails.
--   1. catalogue: RLS, policies, grants per role, function privileges, security definer + search_path, constraints.
--   2. sync behaviour as service_role: lock, retries, stale run, atomic apply, idempotency, duplicates, occurrence changes,
--      incomplete snapshots, missing-name detection, reappearing names, failed runs leave the registry untouched.
--   3. admin review: keep / deactivate / reactivate, never automatic removal.
--   4. authorisation: every role (and anon, service_role) against reads, direct writes, sync functions and review.
\set ON_ERROR_STOP on

begin;

-- helpers (session-local) ----------------------------------------------------------------------------------------------
create function pg_temp.expect_err(p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED_FAIL: % should have failed with %', left(p_sql, 80), p_state;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'EXPECTED_FAIL:%' then raise; end if;
  if sqlstate <> p_state then
    raise exception 'EXPECTED_FAIL: % failed with % (%), wanted %', left(p_sql, 80), sqlstate, sqlerrm, p_state;
  end if;
end;
$$;

create temp table _t (k text primary key, v text);
grant all on _t to public;
grant execute on function pg_temp.expect_err(text, text) to public;

select id::text as admin_id from public.app_users where email = 'admin@example.test' \gset
select id::text as member_id from public.app_users where email = 'member@example.test' \gset
insert into _t values ('admin', :'admin_id'), ('member', :'member_id');

------------------------------------------------------------------------------------------------
-- 1. Catalogue
------------------------------------------------------------------------------------------------
do $$
declare
  t text;
  fn text;
begin
  foreach t in array array['compliance_names', 'compliance_name_sources', 'compliance_sync_runs', 'compliance_settings'] loop
    assert (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass), 'RLS off on ' || t;
    assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = t), 'no policy on ' || t;
    assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and not roles = '{authenticated}'),
      'policy not limited to authenticated on ' || t;
    assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT'),
      'non-select policy on ' || t;
    -- grants per role: anon and service_role nothing; authenticated SELECT only
    assert not exists (select 1 from information_schema.role_table_grants
                       where table_schema = 'public' and table_name = t and grantee in ('anon', 'service_role', 'PUBLIC')),
      'anon/service_role/PUBLIC has table grants on ' || t;
    assert (select array_agg(privilege_type::text order by privilege_type::text) from information_schema.role_table_grants
            where table_schema = 'public' and table_name = t and grantee = 'authenticated') = array['SELECT'],
      'authenticated has more than SELECT on ' || t;
    assert not exists (select 1 from information_schema.column_privileges
                       where table_schema = 'public' and table_name = t and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
                         and privilege_type <> 'SELECT'),
      'column write privilege on ' || t;
  end loop;

  -- the four sync functions: service_role only
  foreach fn in array array[
    'compliance_begin_run(text,uuid,date)', 'compliance_apply_snapshot(uuid,jsonb)',
    'compliance_finish_run(uuid,text,integer,integer,integer,jsonb,jsonb,text,text)', 'compliance_registry_names()',
    'compliance_scheduler_state(date)'
  ] loop
    assert has_function_privilege('service_role', 'public.' || fn, 'execute'), 'service_role cannot run ' || fn;
    assert not has_function_privilege('authenticated', 'public.' || fn, 'execute'), 'authenticated can run ' || fn;
    assert not has_function_privilege('anon', 'public.' || fn, 'execute'), 'anon can run ' || fn;
    assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = ('public.' || fn)::regprocedure and a.grantee = 0),
      'PUBLIC can run ' || fn;
  end loop;
  -- the admin review function: signed-in users (role checked inside), never anon / PUBLIC
  assert has_function_privilege('authenticated', 'public.compliance_review_name(uuid,text,text)', 'execute');
  assert not has_function_privilege('anon', 'public.compliance_review_name(uuid,text,text)', 'execute');
  assert not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                     where p.oid = 'public.compliance_review_name(uuid,text,text)'::regprocedure and a.grantee = 0);
  -- trigger functions are callable by nobody
  foreach fn in array array['compliance_reject_delete()', 'compliance_guard_names()', 'compliance_guard_sources()', 'compliance_guard_runs()'] loop
    assert not has_function_privilege('authenticated', 'public.' || fn, 'execute'), 'authenticated can run ' || fn;
    assert not has_function_privilege('service_role', 'public.' || fn, 'execute'), 'service_role can run ' || fn;
  end loop;

  -- every compliance function: security definer (except trigger fns) with a pinned search_path
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('compliance_begin_run', 'compliance_apply_snapshot', 'compliance_finish_run',
                                                                  'compliance_registry_names', 'compliance_review_name', 'compliance_scheduler_state')
                       and (not p.prosecdef or p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))),
    'a compliance function is not security definer with a pinned search_path';
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname like 'compliance\_%'
                       and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))),
    'a compliance function has no pinned search_path';

  assert exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'compliance_one_running_run'), 'run lock index missing';
  assert (select count(*) from public.compliance_settings) = 1, 'settings must have one row';
  assert (select schedule_days from public.compliance_settings) = array[5, 20], 'default schedule is the 5th and 20th';
  -- FK actions: history cannot be removed through the registry
  assert not exists (select 1 from pg_constraint where conrelid = 'public.compliance_name_sources'::regclass and contype = 'f' and confdeltype <> 'r'),
    'a source FK is not on delete restrict';
end $$;

-- constraints reject bad data
select pg_temp.expect_err($q$insert into public.compliance_names (display_name, normalized, name_types) values ('X', 'Bad  Name', array['client'])$q$, '23514');
select pg_temp.expect_err($q$insert into public.compliance_names (display_name, normalized, name_types) values ('X', 'ok name', array['bogus'])$q$, '23514');
select pg_temp.expect_err($q$insert into public.compliance_names (display_name, normalized, name_types) values ('X', 'ok name', '{}')$q$, '23514');
select pg_temp.expect_err($q$insert into public.compliance_names (display_name, normalized, name_types) values ('', 'ok name', array['client'])$q$, '23514');
select pg_temp.expect_err($q$insert into public.compliance_names (display_name, normalized, name_types, status) values ('X', 'ok name', array['client'], 'pending_removal_review')$q$, '23514');
select pg_temp.expect_err($q$insert into public.compliance_settings (id) values (false)$q$, '23514');
select pg_temp.expect_err($q$update public.compliance_settings set schedule_days = array[31]$q$, '23514');
select pg_temp.expect_err($q$update public.compliance_settings set max_attempts = 0$q$, '23514');

-- the client-list name types and columns are accepted; a column in the wrong section is refused (rolled back by savepoint)
savepoint list_layout;
insert into public.compliance_names (display_name, normalized, name_types) values ('Layout Co', 'layout co', array['client', 'legal', 'friendly', 'group']);
insert into public.compliance_name_sources (name_id, tab_name, section, column_key, source_value, source_row)
  select id, 'Sheet1', 'list', 'friendly_name', 'Layout Co', 2 from public.compliance_names where normalized = 'layout co';
insert into public.compliance_name_sources (name_id, tab_name, section, column_key, source_value, source_row)
  select id, 'Sheet1', 'list', 'client_group', 'Layout Co', 2 from public.compliance_names where normalized = 'layout co';
select pg_temp.expect_err($q$insert into public.compliance_name_sources (name_id, tab_name, section, column_key, source_value) select id, 'Sheet1', 'list', 'new_project', 'x' from public.compliance_names where normalized = 'layout co'$q$, '23514');
select pg_temp.expect_err($q$insert into public.compliance_name_sources (name_id, tab_name, section, column_key, source_value) select id, 'Sheet1', 'clients', 'friendly_name', 'x' from public.compliance_names where normalized = 'layout co'$q$, '23514');
select pg_temp.expect_err($q$insert into public.compliance_name_sources (name_id, tab_name, section, column_key, source_value) select id, 'Sheet1', 'projects', 'legal_name', 'x' from public.compliance_names where normalized = 'layout co'$q$, '23514');
select pg_temp.expect_err($q$insert into public.compliance_name_sources (name_id, tab_name, section, column_key, source_value) select id, 'Sheet1', 'sheet', 'client_name', 'x' from public.compliance_names where normalized = 'layout co'$q$, '23514');
select pg_temp.expect_err($q$insert into public.compliance_names (display_name, normalized, name_types) values ('X', 'six types', array['client', 'legal', 'friendly', 'group', 'project', 'client'])$q$, '23514');
rollback to savepoint list_layout;
do $$ begin assert (select count(*) from public.compliance_names) = 0, 'the savepoint must leave nothing behind'; end $$;

------------------------------------------------------------------------------------------------
-- 2. Sync behaviour (as service_role: the only role that may call the sync functions)
------------------------------------------------------------------------------------------------
set local role service_role;

-- the single-running-run lock, the manual cooldown and the attempt limit
do $$
declare r1 uuid; a1 integer;
begin
  select run_id, attempt into r1, a1 from public.compliance_begin_run('scheduled', null, date '2026-11-05');
  assert a1 = 1, 'first attempt is 1';
  perform pg_temp.expect_err('select * from public.compliance_begin_run(''scheduled'', null, date ''2026-11-20'')', '55006');
  perform pg_temp.expect_err(format('select * from public.compliance_begin_run(%L, %L, null)', 'manual', (select v from _t where k = 'admin')), '55006');
  perform pg_temp.expect_err('select * from public.compliance_begin_run(''bogus'', null, null)', '22023');
  perform pg_temp.expect_err('select * from public.compliance_begin_run(''manual'', null, null)', '22023');
  perform pg_temp.expect_err('select * from public.compliance_begin_run(''scheduled'', null, null)', '22023');
  insert into _t values ('r1', r1::text);
end $$;

-- invalid snapshots are refused whole
do $$
declare r uuid := (select v::uuid from _t where k = 'r1');
begin
  perform pg_temp.expect_err(format('select public.compliance_apply_snapshot(%L, %L::jsonb)', r, '[]'), '22023');
  perform pg_temp.expect_err(format('select public.compliance_apply_snapshot(%L, %L::jsonb)', r, '{"names":[]}'), '22023');
  perform pg_temp.expect_err(format('select public.compliance_apply_snapshot(%L, %L::jsonb)', r, '{"complete":true,"names":[]}'), '22023');
  perform pg_temp.expect_err(format('select public.compliance_apply_snapshot(%L, %L::jsonb)', gen_random_uuid(), '{"complete":false,"names":[]}'), 'P0002');
  -- the same name twice in one snapshot
  perform pg_temp.expect_err(format($f$select public.compliance_apply_snapshot(%L, %L::jsonb)$f$, r,
    '{"complete":false,"names":[{"normalized":"dup co","display":"Dup Co","types":["client"],"occurrences":[]},{"normalized":"dup co","display":"Dup Co","types":["client"],"occurrences":[]}]}'), '22023');
  -- one bad name (not normalised) in the middle: nothing from this snapshot may be kept (atomic)
  perform pg_temp.expect_err(format($f$select public.compliance_apply_snapshot(%L, %L::jsonb)$f$, r,
    '{"complete":false,"names":[{"normalized":"good co","display":"Good Co","types":["client"],"occurrences":[]},{"normalized":"BAD  Name","display":"Bad","types":["client"],"occurrences":[]}]}'), '23514');
  -- a bad occurrence (client column in the projects section)
  perform pg_temp.expect_err(format($f$select public.compliance_apply_snapshot(%L, %L::jsonb)$f$, r,
    '{"complete":false,"names":[{"normalized":"worse co","display":"Worse Co","types":["client"],"occurrences":[{"tab":"June 2026","section":"projects","column":"legal_name","row":1,"value":"Worse Co"}]}]}'), '23514');
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.compliance_names) = 0, 'a refused snapshot must leave no names';
  assert (select count(*) from public.compliance_name_sources) = 0, 'a refused snapshot must leave no occurrences';
end $$;
set local role service_role;

-- snapshot S1 (complete): one name seen as client in June and as project-client in October, its legal name, and a project
do $$
declare
  r uuid := (select v::uuid from _t where k = 'r1');
  res jsonb;
begin
  res := public.compliance_apply_snapshot(r, $s$
    {"complete": true, "names": [
      {"normalized":"example client one","display":"Example Client One","types":["client"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"new_client_name","row":3,"value":"Example Client One"},
        {"tab":"October 2026","section":"projects","column":"client_name","row":8,"value":"example  client one"}]},
      {"normalized":"example client one limited","display":"Example Client One Limited","types":["legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"legal_name","row":3,"value":"Example Client One Limited"}]},
      {"normalized":"project aurora","display":"Project Aurora","types":["project"],"occurrences":[
        {"tab":"October 2026","section":"projects","column":"new_project","row":8,"value":"Project Aurora"}]}]}$s$::jsonb);
  assert (res ->> 'names_new')::int = 3 and (res ->> 'occurrences')::int = 4 and (res ->> 'missing_candidates')::int = 0, 'S1 result ' || res::text;
  -- a run that applied a complete snapshot may succeed; one that did not may not
  perform pg_temp.expect_err(format('select public.compliance_finish_run(%L, %L, 3, 3, 0, ''[]'', ''[]'', null, null)', r, 'bogus'), '22023');
  perform public.compliance_finish_run(r, 'succeeded', 3, 3, 0, '[{"tab":"June 2026","status":"ok"}]'::jsonb, '[]'::jsonb, null, null);
  perform pg_temp.expect_err(format('select public.compliance_finish_run(%L, %L, 0, 0, 0, null, null, null, null)', r, 'failed'), '55000');
  perform pg_temp.expect_err(format('select public.compliance_apply_snapshot(%L, %L::jsonb)', r, '{"complete":false,"names":[]}'), '55000');
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.compliance_names) = 3, 'S1 names';
  -- one canonical name, several occurrences; original spelling kept
  assert (select count(*) from public.compliance_name_sources s join public.compliance_names n on n.id = s.name_id where n.normalized = 'example client one') = 2;
  assert (select display_name from public.compliance_names where normalized = 'example client one') = 'Example Client One';
end $$;
set local role service_role;

-- a scheduled day that already succeeded cannot run again; a manual run records who started it; a second one is on cooldown
do $$
declare m uuid;
begin
  perform pg_temp.expect_err('select * from public.compliance_begin_run(''scheduled'', null, date ''2026-11-05'')', '54000');
  select run_id into m from public.compliance_begin_run('manual', (select v from _t where k = 'admin')::uuid, null);
  -- a failed run (e.g. bad credentials) changes nothing in the registry
  perform public.compliance_finish_run(m, 'failed', 0, 0, 0, '[]'::jsonb, '[]'::jsonb, 'SHEETS_AUTH', 'Google rejected the credentials');
  perform pg_temp.expect_err(format('select * from public.compliance_begin_run(%L, %L, null)', 'manual', (select v from _t where k = 'admin')), '54000');
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.compliance_names) = 3 and (select count(*) from public.compliance_name_sources) = 4, 'failed run changed the registry';
  assert (select triggered_by from public.compliance_sync_runs where trigger = 'manual') = (select v from _t where k = 'admin')::uuid, 'manual run must record the admin';
  assert (select error_code from public.compliance_sync_runs where trigger = 'manual') = 'SHEETS_AUTH';
end $$;
set local role service_role;

-- repeated operation: the same snapshot again changes nothing (idempotent), via a second scheduled day
do $$
declare r uuid; res jsonb;
begin
  select run_id into r from public.compliance_begin_run('scheduled', null, date '2026-11-20');
  res := public.compliance_apply_snapshot(r, $s$
    {"complete": true, "names": [
      {"normalized":"example client one","display":"Example Client One","types":["client"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"new_client_name","row":3,"value":"Example Client One"},
        {"tab":"October 2026","section":"projects","column":"client_name","row":8,"value":"example  client one"}]},
      {"normalized":"example client one limited","display":"Example Client One Limited","types":["legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"legal_name","row":3,"value":"Example Client One Limited"}]},
      {"normalized":"project aurora","display":"Project Aurora","types":["project"],"occurrences":[
        {"tab":"October 2026","section":"projects","column":"new_project","row":8,"value":"Project Aurora"}]}]}$s$::jsonb);
  assert (res ->> 'names_new')::int = 0 and (res ->> 'missing_candidates')::int = 0, 'repeat result ' || res::text;
  perform public.compliance_finish_run(r, 'succeeded', 3, 3, 0, '[]'::jsonb, '[]'::jsonb, null, null);
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.compliance_names) = 3 and (select count(*) from public.compliance_name_sources) = 4, 'repeat duplicated rows';
end $$;
set local role service_role;

-- same name gains a type (seen as a legal name too): ONE record, types merged, spelling kept
do $$
declare r uuid;
begin
  select run_id into r from public.compliance_begin_run('scheduled', null, date '2026-12-05');
  perform public.compliance_apply_snapshot(r, $s$
    {"complete": true, "names": [
      {"normalized":"example client one","display":"EXAMPLE CLIENT ONE","types":["client","legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"new_client_name","row":3,"value":"Example Client One"},
        {"tab":"October 2026","section":"projects","column":"client_name","row":8,"value":"example  client one"},
        {"tab":"November 2026","section":"clients","column":"legal_name","row":2,"value":"EXAMPLE CLIENT ONE"}]},
      {"normalized":"example client one limited","display":"Example Client One Limited","types":["legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"legal_name","row":3,"value":"Example Client One Limited"}]},
      {"normalized":"project aurora","display":"Project Aurora","types":["project"],"occurrences":[
        {"tab":"October 2026","section":"projects","column":"new_project","row":8,"value":"Project Aurora"}]}]}$s$::jsonb);
  perform public.compliance_finish_run(r, 'succeeded', 3, 3, 0, '[]'::jsonb, '[]'::jsonb, null, null);
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.compliance_names where normalized = 'example client one') = 1, 'duplicate canonical record';
  assert (select name_types from public.compliance_names where normalized = 'example client one') = array['client', 'legal'];
  assert (select display_name from public.compliance_names where normalized = 'example client one') = 'Example Client One', 'display spelling must be kept';
  assert (select count(*) from public.compliance_name_sources s join public.compliance_names n on n.id = s.name_id where n.normalized = 'example client one') = 3;
end $$;
set local role service_role;

-- S2 (complete): the October sighting and "Project Aurora" are gone. Aurora is seen nowhere -> pending review (still enforced).
-- Example Client One is still seen in June/November -> no alert even though one occurrence vanished.
do $$
declare r uuid; res jsonb;
begin
  select run_id into r from public.compliance_begin_run('scheduled', null, date '2026-12-20');
  res := public.compliance_apply_snapshot(r, $s$
    {"complete": true, "names": [
      {"normalized":"example client one","display":"Example Client One","types":["client","legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"new_client_name","row":3,"value":"Example Client One"},
        {"tab":"November 2026","section":"clients","column":"legal_name","row":2,"value":"EXAMPLE CLIENT ONE"}]},
      {"normalized":"example client one limited","display":"Example Client One Limited","types":["legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"legal_name","row":3,"value":"Example Client One Limited"}]}]}$s$::jsonb);
  assert (res ->> 'missing_candidates')::int = 1, 'S2 flags exactly Aurora: ' || res::text;
  perform public.compliance_finish_run(r, 'succeeded', 3, 3, 0, '[]'::jsonb, '[]'::jsonb, null, null);
end $$;
reset role;
do $$ begin
  assert (select status from public.compliance_names where normalized = 'project aurora') = 'pending_removal_review';
  assert (select missing_since is not null from public.compliance_names where normalized = 'project aurora');
  assert (select status from public.compliance_names where normalized = 'example client one') = 'active', 'a name seen elsewhere is not flagged';
  -- the vanished occurrence is kept as history, marked unobserved
  assert (select count(*) from public.compliance_name_sources s join public.compliance_names n on n.id = s.name_id
          where n.normalized = 'example client one') = 3;
  assert (select not currently_observed from public.compliance_name_sources s join public.compliance_names n on n.id = s.name_id
          where n.normalized = 'example client one' and s.tab_name = 'October 2026');
  assert (select count(*) from public.compliance_names) = 3, 'nothing is ever removed';
end $$;
set local role service_role;
do $$ begin
  -- a pending name is STILL enforced; the sync role sees it
  assert exists (select 1 from public.compliance_registry_names() where name = 'Project Aurora'), 'pending name must stay enforced';
end $$;

-- scheduler state: settings plus the latest run of the day, no names, no cell values
do $$
declare st jsonb;
begin
  st := public.compliance_scheduler_state(date '2026-12-20');
  assert st -> 'schedule_days' = '[5, 20]'::jsonb and (st ->> 'max_attempts')::int = 4 and (st ->> 'stale_after_days')::int = 20, 'settings in state: ' || st::text;
  assert st -> 'last_run_for_day' ->> 'status' = 'succeeded' and (st -> 'last_run_for_day' ->> 'attempt')::int = 1, 'latest run of that day: ' || st::text;
  assert st ->> 'last_success_at' is not null, 'last success';
  assert (public.compliance_scheduler_state(date '2031-01-01') -> 'last_run_for_day') = 'null'::jsonb, 'no run on a day without one';
  assert not (st::text ilike '%aurora%' or st::text ilike '%example client%'), 'state must hold no names';
end $$;

-- S3 (INCOMPLETE): only one name and a new one. Nothing may be marked unobserved or flagged; new names are still added.
do $$
declare r uuid; res jsonb;
begin
  select run_id into r from public.compliance_begin_run('scheduled', null, date '2027-01-05');
  res := public.compliance_apply_snapshot(r, $s$
    {"complete": false, "names": [
      {"normalized":"example client one limited","display":"Example Client One Limited","types":["legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"legal_name","row":3,"value":"Example Client One Limited"}]},
      {"normalized":"brand new co","display":"Brand New Co","types":["client"],"occurrences":[
        {"tab":"January 2027","section":"clients","column":"new_client_name","row":3,"value":"Brand New Co"}]}]}$s$::jsonb);
  assert (res ->> 'names_new')::int = 1 and (res ->> 'missing_candidates')::int = 0 and not (res ->> 'complete')::boolean, 'S3 ' || res::text;
  -- an incomplete snapshot can never be reported as a full success
  perform pg_temp.expect_err(format('select public.compliance_finish_run(%L, %L, 3, 2, 1, ''[]'', ''[]'', null, null)', r, 'succeeded'), '22023');
  perform public.compliance_finish_run(r, 'partial', 3, 2, 1, '[{"tab":"July 2026","status":"unparseable"}]'::jsonb, '[]'::jsonb, 'SHEETS_PARSE', 'One tab could not be parsed');
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.compliance_name_sources s join public.compliance_names n on n.id = s.name_id
          where n.normalized = 'example client one' and s.currently_observed) = 2, 'incomplete run must not unmark occurrences';
  assert (select status from public.compliance_names where normalized = 'project aurora') = 'pending_removal_review', 'unchanged by incomplete run';
  assert (select status from public.compliance_names where normalized = 'brand new co') = 'active';
end $$;
set local role service_role;

-- a partial run may be retried on the same scheduled day (attempt 2); the limit then stops it
do $$
declare r uuid; a integer;
begin
  select run_id, attempt into r, a from public.compliance_begin_run('scheduled', null, date '2027-01-05');
  assert a = 2, 'retry is attempt 2, got ' || a;
  perform public.compliance_finish_run(r, 'failed', 0, 0, 0, '[]'::jsonb, '[]'::jsonb, 'SHEETS_RATE_LIMIT', 'Google asked us to slow down');
  select run_id, attempt into r, a from public.compliance_begin_run('scheduled', null, date '2027-01-05');
  assert a = 3;
  perform public.compliance_finish_run(r, 'failed', 0, 0, 0, '[]'::jsonb, '[]'::jsonb, 'SHEETS_RATE_LIMIT', null);
end $$;
reset role;
update public.compliance_settings set max_attempts = 3;
set local role service_role;
select pg_temp.expect_err('select * from public.compliance_begin_run(''scheduled'', null, date ''2027-01-05'')', '54000');
reset role;
update public.compliance_settings set max_attempts = 4;

-- a run stuck as "running" for 20 minutes is closed by the next run instead of blocking everything
insert into public.compliance_sync_runs (trigger, scheduled_for, started_at) values ('scheduled', date '2027-02-05', now() - interval '20 minutes');
set local role service_role;
do $$
declare r uuid;
begin
  select run_id into r from public.compliance_begin_run('scheduled', null, date '2027-02-20');
  perform public.compliance_finish_run(r, 'failed', 0, 0, 0, '[]'::jsonb, '[]'::jsonb, 'X', null);
end $$;
reset role;
do $$ begin
  assert (select error_code from public.compliance_sync_runs where scheduled_for = date '2027-02-05') = 'STALE_RUN';
end $$;
set local role service_role;

-- S4 (complete): Aurora is back -> active again; Brand New Co was only seen by the incomplete run -> flagged now
do $$
declare r uuid; res jsonb;
begin
  select run_id into r from public.compliance_begin_run('scheduled', null, date '2027-03-05');
  res := public.compliance_apply_snapshot(r, $s$
    {"complete": true, "names": [
      {"normalized":"example client one","display":"Example Client One","types":["client","legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"new_client_name","row":3,"value":"Example Client One"}]},
      {"normalized":"example client one limited","display":"Example Client One Limited","types":["legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"legal_name","row":3,"value":"Example Client One Limited"}]},
      {"normalized":"project aurora","display":"Project Aurora","types":["project"],"occurrences":[
        {"tab":"March 2027","section":"projects","column":"new_project","row":4,"value":"Project Aurora"}]}]}$s$::jsonb);
  assert (res ->> 'missing_candidates')::int = 1, 'S4 ' || res::text;
  perform public.compliance_finish_run(r, 'succeeded', 3, 3, 0, '[]'::jsonb, '[]'::jsonb, null, null);
end $$;
reset role;
do $$ begin
  assert (select status from public.compliance_names where normalized = 'project aurora') = 'active', 'a name seen again is active again';
  assert (select missing_since is null from public.compliance_names where normalized = 'project aurora');
  assert (select status from public.compliance_names where normalized = 'brand new co') = 'pending_removal_review';
end $$;

------------------------------------------------------------------------------------------------
-- 3. Admin review (as the seeded admin): keep, deactivate, reactivate. Removal is never automatic.
------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare brand uuid := (select id from public.compliance_names where normalized = 'brand new co');
        aurora uuid := (select id from public.compliance_names where normalized = 'project aurora');
begin
  perform pg_temp.expect_err(format('select public.compliance_review_name(%L, %L, null)', brand, 'bogus'), '22023');
  perform pg_temp.expect_err(format('select public.compliance_review_name(%L, %L, null)', gen_random_uuid(), 'keep'), 'P0002');
  perform pg_temp.expect_err(format('select public.compliance_review_name(%L, %L, null)', aurora, 'keep'), '22023'); -- not pending
  perform pg_temp.expect_err(format('select public.compliance_review_name(%L, %L, %L)', brand, 'keep', repeat('x', 501)), '22023');
  perform public.compliance_review_name(brand, 'keep', 'still a client');
  assert (select status from public.compliance_names where id = brand) = 'active';
  assert (select review_note from public.compliance_names where id = brand) = 'still a client';
  perform pg_temp.expect_err(format('select public.compliance_review_name(%L, %L, null)', brand, 'reactivate'), '22023'); -- not deactivated
end $$;

reset role;
do $$
declare cnt int;
begin
  select count(*) into cnt from public.audit_log where action = 'compliance_name_review' and entity_id = (select id from public.compliance_names where normalized = 'brand new co');
  assert cnt = 1, 'the review must be audited';
  assert exists (select 1 from public.audit_log where action = 'compliance_sync' and entity = 'compliance_sync_run'), 'sync must be audited';
  assert exists (select 1 from public.audit_log where action = 'compliance_sync_start' and actor_id = (select v from _t where k = 'admin')::uuid), 'manual start must be audited with the admin';
end $$;

-- "keep" holds: a later complete run that still lacks the name does not flag it again
set local role service_role;
do $$
declare r uuid; res jsonb;
begin
  select run_id into r from public.compliance_begin_run('scheduled', null, date '2027-03-20');
  res := public.compliance_apply_snapshot(r, $s$
    {"complete": true, "names": [
      {"normalized":"example client one","display":"Example Client One","types":["client","legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"new_client_name","row":3,"value":"Example Client One"}]},
      {"normalized":"example client one limited","display":"Example Client One Limited","types":["legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"legal_name","row":3,"value":"Example Client One Limited"}]},
      {"normalized":"project aurora","display":"Project Aurora","types":["project"],"occurrences":[
        {"tab":"March 2027","section":"projects","column":"new_project","row":4,"value":"Project Aurora"}]}]}$s$::jsonb);
  assert (res ->> 'missing_candidates')::int = 0, 'kept name must not be flagged again: ' || res::text;
  perform public.compliance_finish_run(r, 'succeeded', 3, 3, 0, '[]'::jsonb, '[]'::jsonb, null, null);
end $$;
reset role;

-- deactivate -> not enforced; a sync that sees it again does NOT reactivate it; only an admin does
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare aurora uuid := (select id from public.compliance_names where normalized = 'project aurora');
begin
  perform public.compliance_review_name(aurora, 'deactivate', 'retired');
  perform pg_temp.expect_err(format('select public.compliance_review_name(%L, %L, null)', aurora, 'deactivate'), '22023');
end $$;
reset role;
set local role service_role;
do $$
declare r uuid; res jsonb;
begin
  assert not exists (select 1 from public.compliance_registry_names() where name = 'Project Aurora'), 'deactivated name must not be enforced';
  select run_id into r from public.compliance_begin_run('scheduled', null, date '2027-04-05');
  res := public.compliance_apply_snapshot(r, $s$
    {"complete": true, "names": [
      {"normalized":"example client one","display":"Example Client One","types":["client","legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"new_client_name","row":3,"value":"Example Client One"}]},
      {"normalized":"example client one limited","display":"Example Client One Limited","types":["legal"],"occurrences":[
        {"tab":"June 2026","section":"clients","column":"legal_name","row":3,"value":"Example Client One Limited"}]},
      {"normalized":"project aurora","display":"Project Aurora","types":["project"],"occurrences":[
        {"tab":"March 2027","section":"projects","column":"new_project","row":4,"value":"Project Aurora"}]}]}$s$::jsonb);
  assert (res ->> 'seen_again_but_deactivated')::int = 1, 'admin must be told: ' || res::text;
  perform public.compliance_finish_run(r, 'succeeded', 3, 3, 0, '[]'::jsonb, '[]'::jsonb, null, null);
  assert not exists (select 1 from public.compliance_registry_names() where name = 'Project Aurora'), 'a sync must not reactivate';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare aurora uuid := (select id from public.compliance_names where normalized = 'project aurora');
begin
  perform public.compliance_review_name(aurora, 'reactivate', null);
  assert (select status from public.compliance_names where id = aurora) = 'active';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.compliance_names) = 4, 'no name was ever removed through all of this';
end $$;

------------------------------------------------------------------------------------------------
-- 4. Guard triggers: nobody can delete or rewrite history (here as the table owner)
------------------------------------------------------------------------------------------------
select pg_temp.expect_err($q$delete from public.compliance_names$q$, '42501');
select pg_temp.expect_err($q$delete from public.compliance_name_sources$q$, '42501');
select pg_temp.expect_err($q$delete from public.compliance_sync_runs$q$, '42501');
select pg_temp.expect_err($q$update public.compliance_names set normalized = 'renamed'$q$, '42501');
select pg_temp.expect_err($q$update public.compliance_name_sources set tab_name = 'Other'$q$, '42501');
select pg_temp.expect_err($q$update public.compliance_name_sources set first_seen_at = now() - interval '1 year'$q$, '42501');
select pg_temp.expect_err($q$update public.compliance_sync_runs set status = 'failed' where status = 'succeeded'$q$, '42501');

------------------------------------------------------------------------------------------------
-- 5. Authorisation: each role against reads, direct writes, sync functions and review
------------------------------------------------------------------------------------------------
select id::text as someone from public.compliance_names limit 1 \gset
do $$
declare
  em text;
  uid uuid;
  can_staff boolean;
  can_admin boolean;
  n_names bigint; n_sources bigint; n_runs bigint; n_settings bigint;
begin
  foreach em in array array['member@example.test', 'member2@example.test', 'checker@example.test', 'manager@example.test', 'admin@example.test'] loop
    select id into uid from public.app_users where email = em;
    can_staff := em in ('manager@example.test', 'admin@example.test');
    can_admin := em = 'admin@example.test';
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    select count(*) into n_names from public.compliance_names;
    select count(*) into n_sources from public.compliance_name_sources;
    select count(*) into n_runs from public.compliance_sync_runs;
    select count(*) into n_settings from public.compliance_settings;
    assert (n_names > 0) = can_staff, em || ' names visibility ' || n_names;
    assert (n_sources > 0) = can_staff, em || ' sources visibility ' || n_sources;
    assert (n_runs > 0) = can_admin, em || ' runs visibility ' || n_runs;
    assert (n_settings > 0) = can_admin, em || ' settings visibility ' || n_settings;

    -- nobody signed in, not even an admin, can write the tables directly
    perform pg_temp.expect_err($q$insert into public.compliance_names (display_name, normalized, name_types) values ('X', 'sneaky co', array['client'])$q$, '42501');
    perform pg_temp.expect_err($q$update public.compliance_names set status = 'deactivated'$q$, '42501');
    perform pg_temp.expect_err($q$delete from public.compliance_names$q$, '42501');
    perform pg_temp.expect_err($q$insert into public.compliance_name_sources (name_id, tab_name, section, column_key, source_value) select id, 'T', 'clients', 'legal_name', 'x' from public.compliance_names limit 1$q$, '42501');
    perform pg_temp.expect_err($q$update public.compliance_settings set schedule_days = array[1]$q$, '42501');
    perform pg_temp.expect_err($q$insert into public.compliance_sync_runs (trigger) values ('manual')$q$, '42501');
    perform pg_temp.expect_err($q$update public.compliance_sync_runs set status = 'failed'$q$, '42501');
    perform pg_temp.expect_err($q$truncate public.compliance_names$q$, '42501');

    -- nobody signed in can call the sync functions or read the enforcement list
    perform pg_temp.expect_err(format('select * from public.compliance_begin_run(%L, %L, null)', 'manual', uid), '42501');
    perform pg_temp.expect_err('select public.compliance_apply_snapshot(gen_random_uuid(), ''{"complete":false,"names":[]}''::jsonb)', '42501');
    perform pg_temp.expect_err('select public.compliance_finish_run(gen_random_uuid(), ''failed'', 0, 0, 0, null, null, null, null)', '42501');
    perform pg_temp.expect_err('select * from public.compliance_registry_names()', '42501');
    perform pg_temp.expect_err('select public.compliance_scheduler_state(current_date)', '42501');

    -- review: only an admin (checked inside the function, not just by the grant)
    if can_admin then
      perform public.compliance_review_name((select id from public.compliance_names order by normalized limit 1), 'deactivate', null);
      perform public.compliance_review_name((select id from public.compliance_names order by normalized limit 1), 'reactivate', null);
    else
      perform pg_temp.expect_err(format('select public.compliance_review_name(%L, %L, null)', (select id from public.compliance_names order by normalized limit 1), 'deactivate'), '42501');
    end if;

    execute 'reset role';
  end loop;
end $$;

-- a signed-in call with no user id at all is "not authenticated"
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;
select pg_temp.expect_err(format('select public.compliance_review_name(%L, %L, null)', :'someone'::uuid, 'deactivate'), '28000');
reset role;

-- anon: nothing at all
set local role anon;
select pg_temp.expect_err('select count(*) from public.compliance_names', '42501');
select pg_temp.expect_err('select count(*) from public.compliance_sync_runs', '42501');
select pg_temp.expect_err('insert into public.compliance_names (display_name, normalized, name_types) values (''X'', ''anon co'', array[''client''])', '42501');
select pg_temp.expect_err(format('select public.compliance_review_name(%L, %L, null)', :'someone'::uuid, 'deactivate'), '42501');
select pg_temp.expect_err('select * from public.compliance_registry_names()', '42501');
select pg_temp.expect_err('select public.compliance_scheduler_state(current_date)', '42501');
reset role;

-- service_role (the sync key): functions only, NO direct table access
set local role service_role;
select pg_temp.expect_err('select count(*) from public.compliance_names', '42501');
select pg_temp.expect_err('select count(*) from public.compliance_sync_runs', '42501');
select pg_temp.expect_err('delete from public.compliance_names', '42501');
select pg_temp.expect_err('update public.compliance_names set status = ''deactivated''', '42501');
select pg_temp.expect_err('insert into public.compliance_names (display_name, normalized, name_types) values (''X'', ''svc co'', array[''client''])', '42501');
reset role;

rollback;

select 'COMPLIANCE REGISTRY CHECK PASSED' as result;
