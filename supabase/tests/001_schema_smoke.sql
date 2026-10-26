-- Purpose: smoke test for the init migration. Runs as the postgres role (bypasses RLS; the per-role
-- RLS tests are `npm run test:rls`, added with the policies). Everything runs in one transaction that
-- is rolled back, so the database is left untouched. Fictional data only.
-- Run: npm run db:smoke   (prints "SMOKE TEST PASSED" on success; any failed assert aborts)
\set ON_ERROR_STOP on
begin;

-- 1. Domain check -----------------------------------------------------------------------------
do $$
begin
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'someone@gmail.com');
    raise exception 'FAIL: outside domain accepted';
  exception when insufficient_privilege then null; end;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'smoke@example.test');
    raise exception 'FAIL: example.test accepted while exception is off';
  exception when insufficient_privilege then null; end;
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'Tester@InfoBeans.com');
  assert (select count(*) from public.app_users where id = '00000000-0000-0000-0000-0000000000a1') = 1, 'app_users row missing';
  update public.app_settings set value = 'on' where key = 'allow_example_test';
  insert into auth.users (id, email) values (gen_random_uuid(), 'smoke@example.test');
  update public.app_settings set value = 'off' where key = 'allow_example_test';
end $$;

-- act as the tester
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- 2. Round trips ------------------------------------------------------------------------------
create temp table fixtures (template public.template_kind, doc jsonb);
insert into fixtures values
('internal', $json${
  "name":"Asha Verma","jobTitle":"Senior Engineer","experienceSummary":"8+ Years of Industry Experience",
  "specialization":"Cloud native backend","overview":"Line one.\nLine two.\n\nLine four.",
  "education":[{"year":"2014","qualification":"B.Tech"}],
  "projects":[
    {"duration":"2021-2023","title":"Ledger","toolsAndTechnologies":["Java","Kafka"],"teamSize":"2-3","role":"Lead",
     "projectLink":"https://example.test/ledger","description":"First para.\nSecond line.","responsibilities":["Designed APIs","Mentored"]},
    {"duration":"2019","title":"Portal","toolsAndTechnologies":["React"],"teamSize":"","role":"Dev",
     "projectLink":"","description":"Portal build","responsibilities":["Built UI"]}],
  "skills":[{"name":"Java","rating":"4.0"},{"name":"SQL","rating":"4"},{"name":"Go","rating":""}],
  "certifications":["AWS SA"],"tools":["Docker","Git"],"managerialExperience":[],
  "domains":["Fintech"],"languages":["English","Hindi"]}$json$::jsonb),
('external', $json${
  "name":"Ravi Kumar","jobTitle":"QA Lead","experienceSummary":"free text summary","specialization":"Test automation",
  "overview":"Overview line one.\nLine two.",
  "education":[{"year":"2012","qualification":"MCA"}],
  "skills":["Selenium","Cypress"],"tools":["Jira"],"certifications":["ISTQB"],
  "projects":[{"duration":"2020-2022","client":"Acme Retail","teamSize":"5","role":"Lead","description":"Automation.\nMore.","responsibilities":["Led team","Wrote suites"]}],
  "experience":[{"company":"Globex","position":"QA Lead","duration":"2018-2022","highlights":["Cut regression time","Built framework"]}]}$json$::jsonb);

do $$
declare
  f record; v record; v2 record; v3 record; got jsonb; pid uuid;
begin
  for f in select * from fixtures loop
    select * into v from public.save_profile_version(null, f.template, 'base', 'Base', null, 'upload',
      f.doc, '[{"path":"projects.0.duration","reason":"estimated"}]'::jsonb, '{"documentType":"standard_resume"}'::jsonb, array['module_a']);
    assert v.new_version_no = 1, 'first version should be 1';
    got := public.get_profile_version(v.new_version_id);
    assert got -> 'data' = f.doc, format('ROUND TRIP FAILED (%s): %s', f.template, got -> 'data');
    assert got -> 'reviewFlags' = '[{"path":"projects.0.duration","reason":"estimated"}]'::jsonb, 'flags mismatch';
    assert got -> 'promptPlan' = '["module_a"]'::jsonb, 'prompt plan mismatch';
    assert got #>> '{meta,versionNo}' = '1', 'meta versionNo';
    select profile_id into pid from public.profile_versions where id = v.new_version_id;

    select * into v2 from public.save_profile_version(pid, f.template, 'base', 'Base', v.new_version_id, 'edit',
      f.doc || '{"name":"Edited Name"}', '[]', null, null);
    assert v2.new_version_no = 2, 'second version should be 2';
    select * into v3 from public.save_profile_version(pid, f.template, 'role_specific', 'Java Backend', v2.new_version_id, 'edit',
      f.doc, '[]', null, null);
    assert v3.new_version_no = 3, 'third version should be 3';
    assert (select current_version_id from public.profiles where id = pid) = v3.new_version_id, 'current_version_id';
    assert (select candidate_name from public.profiles where id = pid) = f.doc ->> 'name', 'candidate_name';
    assert (select search @@ plainto_tsquery('simple', 'kafka') from public.profile_versions where id = v.new_version_id) = (f.template = 'internal'), 'search column';
    assert (select count(*) from public.audit_log where entity_id = v.new_version_id and action = 'save_version') = 1, 'audit row';
  end loop;
end $$;

-- 3. Guards -----------------------------------------------------------------------------------
do $$
declare pid uuid; vid uuid; d jsonb := (select doc from fixtures where template = 'internal');
begin
  select profile_id, id into pid, vid from public.profile_versions order by created_at limit 1;
  -- immutability, every table
  begin update public.profile_versions set label = 'x' where id = vid; raise exception 'FAIL: version update allowed';
  exception when insufficient_privilege then null; end;
  begin update public.version_skills set name = 'x'; raise exception 'FAIL: child update allowed';
  exception when insufficient_privilege then null; end;
  begin update public.audit_log set action = 'x'; raise exception 'FAIL: audit update allowed';
  exception when insufficient_privilege then null; end;
  begin delete from public.audit_log; raise exception 'FAIL: audit delete allowed';
  exception when insufficient_privilege then null; end;
  -- bad rating, two education entries, missing parent, wrong template, unauthenticated
  begin perform public.save_profile_version(null, 'internal', 'base', '', null, 'edit',
          jsonb_set(d, '{skills,0,rating}', '"abc"'), '[]', null, null);
        raise exception 'FAIL: bad rating accepted';
  exception when check_violation then null; end;
  begin perform public.save_profile_version(null, 'internal', 'base', '', null, 'edit',
          jsonb_set(d, '{education}', '[{"year":"","qualification":""},{"year":"","qualification":""}]'), '[]', null, null);
        raise exception 'FAIL: two education entries accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.save_profile_version(pid, 'external', 'base', '', null, 'edit', d, '[]', null, null);
        raise exception 'FAIL: wrong template accepted';
  exception when no_data_found then null; end;
  begin perform public.save_profile_version(pid, 'internal', 'role_specific', '', null, 'edit', d, '[]', null, null);
        raise exception 'FAIL: role-specific without parent accepted';
  exception when invalid_parameter_value then null; end;
  -- deleting a version nulls children's parent link; deleting a profile cascades
  delete from public.profile_versions where id = vid;
  assert (select parent_version_id from public.profile_versions where parent_version_id = vid) is null, 'parent not nulled';
  delete from public.profiles where id = pid;
  assert (select count(*) from public.version_projects) > 0, 'other profile should remain';
end $$;

select set_config('request.jwt.claims', '', true);
do $$
begin
  begin perform public.save_profile_version(null, 'internal', 'base', '', null, 'edit', '{}', '[]', null, null);
        raise exception 'FAIL: unauthenticated save accepted';
  exception when invalid_authorization_specification then null; end;
end $$;

-- 4. Security posture -------------------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert bad is null, 'RLS not enabled on: ' || coalesce(bad, '');
  select string_agg(table_name || ':' || privilege_type, ', ') into bad from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  assert bad is null, 'anon has table privileges: ' || coalesce(bad, '');
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  assert bad is null, 'anon can execute: ' || coalesce(bad, '');
end $$;

-- 5. Primary profile (20261014120000_primary_profile.sql) --------------------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'Other@InfoBeans.com');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare
  v_doc jsonb := (select doc from fixtures where template = 'internal' limit 1);
  a record; b record; c record; n int;
  v_a1 uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  delete from public.profiles where owner_id = v_a1;  -- start from "no profiles, no primary"
  -- first submitted profile becomes primary automatically
  select * into a from public.submit_profile_version(null, 'internal', 'base', '', null, 'scratch', v_doc, '[]', null, null, false);
  assert a.is_primary, 'first submitted profile must become primary';
  -- a second profile without the box: the first stays primary
  select * into b from public.submit_profile_version(null, 'internal', 'base', '', null, 'scratch', v_doc, '[]', null, null, false);
  assert not b.is_primary, 'a later profile must not take over the primary on its own';
  -- a new version of the primary profile keeps it primary (and does not move it)
  select * into c from public.submit_profile_version(a.profile_id, 'internal', 'base', '', null, 'edit', v_doc, '[]', null, null, false);
  assert c.profile_id = a.profile_id and c.is_primary and c.new_version_no = 2, 'a new version keeps its profile primary';
  -- a new version of a non-primary profile does not change the primary
  perform public.submit_profile_version(b.profile_id, 'internal', 'base', '', null, 'edit', v_doc, '[]', null, null, false);
  assert (select id from public.profiles where owner_id = v_a1 and is_primary) = a.profile_id, 'saving another profile must not move the primary';
  -- Submit with the box ticked: saves and switches in one step
  select * into c from public.submit_profile_version(b.profile_id, 'internal', 'base', '', null, 'edit', v_doc, '[]', null, null, true);
  assert c.is_primary, 'submit with p_make_primary must make the profile primary';
  select count(*) into n from public.profiles where owner_id = v_a1 and is_primary;
  assert n = 1, 'exactly one primary after a switch, found ' || n;
  -- switch back with set_primary_profile
  perform public.set_primary_profile(a.profile_id);
  assert (select array_agg(id) from public.profiles where owner_id = v_a1 and is_primary) = array[a.profile_id], 'set_primary_profile switches atomically';
  -- the unique index: a second primary cannot exist
  begin
    update public.profiles set is_primary = true where id = b.profile_id;
    raise exception 'FAIL: two primaries accepted';
  exception when unique_violation then null; end;
  -- an archived profile cannot become primary
  update public.profiles set archived = true where id = b.profile_id;
  begin perform public.set_primary_profile(b.profile_id); raise exception 'FAIL: archived profile made primary';
  exception when invalid_parameter_value then null; end;
  -- someone else cannot set it, neither through the function nor directly (trigger), even as the table owner
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
  begin perform public.set_primary_profile(a.profile_id); raise exception 'FAIL: non-owner set primary';
  exception when insufficient_privilege then null; end;
  begin update public.profiles set is_primary = false where id = a.profile_id; raise exception 'FAIL: non-owner cleared primary';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', '', true);
  begin perform public.set_primary_profile(a.profile_id); raise exception 'FAIL: unauthenticated set primary';
  exception when invalid_authorization_specification then null; end;
end $$;

rollback;
\echo SMOKE TEST PASSED
