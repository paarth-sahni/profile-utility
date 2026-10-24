-- READ-ONLY pre-check, run on the hosted database BEFORE applying the three compliance migrations.
-- It changes nothing. Every check should return the expected value shown in the comment; if one does not, stop and ask.
-- (Supabase dashboard > SQL editor, or psql.) Take a backup / confirm point-in-time recovery first.

-- 1. None of the new objects exist yet (expect 0 and 0 and 0).
select count(*) as existing_compliance_tables
from pg_tables where schemaname = 'public' and tablename like 'compliance\_%';
select count(*) as existing_compliance_functions
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'compliance\_%';
select count(*) as existing_compliance_triggers from pg_trigger where not tgisinternal and tgname like 'compliance\_%';

-- 2. The objects the migrations rely on exist (expect: true, true, true).
select to_regprocedure('public.current_app_role()') is not null as has_current_app_role,
       to_regclass('public.audit_log') is not null as has_audit_log,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_log' and column_name = 'detail') as audit_log_has_detail;

-- 3. The service_role and authenticated roles exist (expect 2 rows).
select rolname from pg_roles where rolname in ('service_role', 'authenticated') order by 1;

-- 4. Last applied migration (expect 20261015120000 or later; the three new ones must NOT be listed yet).
select max(version) as last_migration from supabase_migrations.schema_migrations;
select version from supabase_migrations.schema_migrations where version in ('20261023120000', '20261023120100', '20261023120200');

-- 5. Row counts of the main tables, to compare after (write these down).
select (select count(*) from public.app_users) as app_users, (select count(*) from public.profiles) as profiles,
       (select count(*) from public.profile_versions) as profile_versions, (select count(*) from public.audit_log) as audit_log;
