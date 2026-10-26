-- READ-ONLY verification, run on the hosted database AFTER the three compliance migrations were applied.
-- It changes nothing. Compare each result with the expected value in the comment.

-- 1. Four tables, row level security on, one SELECT-only policy each (expect 4 rows, all rls = true, policies = 1).
select c.relname as table_name, c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'compliance\_%' and c.relkind = 'r' order by 1;

-- 2. Table privileges (expect ONLY: authenticated / SELECT on each of the four tables; nothing for anon, service_role, PUBLIC).
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'compliance\_%'
  and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC') order by 1, 2, 3;

-- 3. Function privileges (expect: the four sync functions run by service_role ONLY; review function by authenticated, not anon).
select p.proname,
       has_function_privilege('service_role', p.oid, 'execute') as service_role,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       p.prosecdef as security_definer,
       exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as search_path_pinned
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('compliance_begin_run', 'compliance_apply_snapshot', 'compliance_finish_run',
                                              'compliance_registry_names', 'compliance_review_name', 'compliance_scheduler_state') order by 1;
-- expected: begin_run / apply_snapshot / finish_run / registry_names / scheduler_state = true,false,false ; review_name = true,true,false ;
--           security_definer = true and search_path_pinned = true on all six.

-- 4. Guard triggers present (expect 6) and the single-running-run index present (expect 1).
select count(*) as guard_triggers from pg_trigger where not tgisinternal and tgname like 'compliance\_%';
select count(*) as run_lock_index from pg_indexes where schemaname = 'public' and indexname = 'compliance_one_running_run';

-- 5. Default data (expect one settings row: {5,20}, 4, 20; and nothing else yet).
select schedule_days, max_attempts, stale_after_days from public.compliance_settings;
select (select count(*) from public.compliance_names) as names, (select count(*) from public.compliance_name_sources) as sources,
       (select count(*) from public.compliance_sync_runs) as runs;

-- 6. Existing data untouched: compare with the numbers noted from compliance-precheck.sql.
select (select count(*) from public.app_users) as app_users, (select count(*) from public.profiles) as profiles,
       (select count(*) from public.profile_versions) as profile_versions, (select count(*) from public.audit_log) as audit_log;
