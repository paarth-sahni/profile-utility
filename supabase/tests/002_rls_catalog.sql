-- Purpose: catalogue checks for Row Level Security, run by `npm run test:rls` before the API-level tests.
-- Proves from pg_catalog that every public table has RLS on and a policy (app_settings is the one
-- deliberate exception: no policy, no grant), and that grants cannot bypass immutability.
-- Read-only: changes nothing. Prints "RLS CATALOG CHECK PASSED" or fails with the offending names.
\set ON_ERROR_STOP on

do $$
declare
  v_bad text;
begin
  -- 1. RLS enabled on every table in public (no exceptions).
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  assert v_bad is null, 'RLS disabled on: ' || v_bad;

  -- 2. Every table except app_settings has at least one policy; app_settings has none.
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'app_settings'
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);
  assert v_bad is null, 'no policy on: ' || v_bad;
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings'),
    'app_settings must have no policy';

  -- 3. No policy is granted to anon or PUBLIC.
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
  from pg_policies where schemaname = 'public' and not (roles = '{authenticated}');
  assert v_bad is null, 'policy not limited to authenticated: ' || v_bad;

  -- 4. anon has no privilege on any table or sequence; authenticated has none on app_settings.
  select string_agg(table_name || ':' || privilege_type, ', ') into v_bad
  from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';
  assert v_bad is null, 'anon has table grants: ' || v_bad;
  select string_agg(privilege_type, ', ') into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated' and table_name = 'app_settings';
  assert v_bad is null, 'authenticated can touch app_settings: ' || v_bad;

  -- 5. Immutable tables: authenticated has no table-level or column-level UPDATE, and no TRUNCATE anywhere.
  select string_agg(distinct table_name, ', ') into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'UPDATE'
    and table_name in ('profile_versions', 'version_education', 'version_projects', 'project_technologies',
                       'project_responsibilities', 'version_skills', 'version_list_items', 'version_experience',
                       'experience_highlights', 'version_review_flags', 'audit_log');
  assert v_bad is null, 'authenticated can UPDATE immutable tables: ' || v_bad;
  select string_agg(distinct table_name, ', ') into v_bad
  from information_schema.column_privileges
  where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'UPDATE'
    and table_name in ('profile_versions', 'version_education', 'version_projects', 'project_technologies',
                       'project_responsibilities', 'version_skills', 'version_list_items', 'version_experience',
                       'experience_highlights', 'version_review_flags', 'audit_log');
  assert v_bad is null, 'authenticated has column UPDATE on immutable tables: ' || v_bad;
  assert not exists (select 1 from information_schema.role_table_grants
                     where table_schema = 'public' and grantee = 'authenticated' and privilege_type = 'TRUNCATE'),
    'authenticated has TRUNCATE';

  -- 6. No policy allows UPDATE or DELETE on immutable tables (children are removed by cascade only).
  select string_agg(tablename || '.' || policyname, ', ') into v_bad
  from pg_policies where schemaname = 'public'
    and tablename in ('profile_versions', 'version_education', 'version_projects', 'project_technologies',
                      'project_responsibilities', 'version_skills', 'version_list_items', 'version_experience',
                      'experience_highlights', 'version_review_flags', 'audit_log')
    and cmd in ('UPDATE', 'ALL')
    or (schemaname = 'public' and tablename <> 'profile_versions' and cmd = 'DELETE'
        and tablename in ('version_education', 'version_projects', 'project_technologies', 'project_responsibilities',
                          'version_skills', 'version_list_items', 'version_experience', 'experience_highlights',
                          'version_review_flags', 'audit_log'));
  assert v_bad is null, 'mutating policy on immutable table: ' || v_bad;
end $$;

select 'RLS CATALOG CHECK PASSED' as result;
