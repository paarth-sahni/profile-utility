-- Purpose: proves supabase/rollback/20261023_compliance_rollback.sql removes ONLY the compliance objects and leaves every
-- other table, function and row alone. Runs the rollback inside a transaction, checks, then ROLLS BACK (nothing is dropped
-- for real). Run: `npm run test:compliance` (from the profile-main folder; the \ir path is relative to this file).
\set ON_ERROR_STOP on

begin;

-- snapshot of everything that is NOT compliance, before
create temp table _before as
select 'table:' || c.relname as k, c.reltuples::bigint as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname not like 'compliance\_%'
union all
select 'func:' || p.oid::regprocedure::text, 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname not like 'compliance\_%'
union all
select 'policy:' || tablename || '.' || policyname, 0 from pg_policies where schemaname = 'public' and tablename not like 'compliance\_%'
union all
select 'trigger:' || tgrelid::regclass::text || '.' || tgname, 0 from pg_trigger
where not tgisinternal and tgname not like 'compliance\_%';

create temp table _rows as
select (select count(*) from public.app_users) as app_users, (select count(*) from public.profiles) as profiles,
       (select count(*) from public.profile_versions) as versions, (select count(*) from public.audit_log) as audit;

-- the compliance objects exist now
do $$ begin
  assert (select count(*) from pg_tables where schemaname = 'public' and tablename like 'compliance\_%') = 4;
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'compliance\_%') = 10;
end $$;

-- the rollback script itself (no begin/commit of its own, so it runs inside this transaction)
\ir ../rollback/20261023_compliance_rollback.sql

-- gone: every compliance table and function
do $$ begin
  assert (select count(*) from pg_tables where schemaname = 'public' and tablename like 'compliance\_%') = 0, 'a compliance table is left';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'compliance\_%') = 0, 'a compliance function is left';
  assert (select count(*) from pg_policies where tablename like 'compliance\_%') = 0, 'a compliance policy is left';
  assert (select count(*) from pg_trigger where not tgisinternal and tgname like 'compliance\_%') = 0, 'a compliance trigger is left';
end $$;

-- untouched: every other table, function, policy and trigger, and the rows of the main tables
create temp table _after as
select 'table:' || c.relname as k, c.reltuples::bigint as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
union all
select 'func:' || p.oid::regprocedure::text, 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
union all
select 'policy:' || tablename || '.' || policyname, 0 from pg_policies where schemaname = 'public'
union all
select 'trigger:' || tgrelid::regclass::text || '.' || tgname, 0 from pg_trigger where not tgisinternal;

do $$
declare lost text; gained text;
begin
  select string_agg(k, ', ') into lost from (select k from _before except select k from _after) x;
  select string_agg(k, ', ') into gained from (select k from _after except select k from _before) x;
  assert lost is null, 'the rollback removed something that is not compliance: ' || lost;
  assert gained is null, 'unexpected objects after rollback: ' || gained;
  -- application data: same number of rows as before (the rollback never touches it; audit_log rows are kept)
  assert (select count(*) from public.app_users) = (select app_users from _rows), 'app_users rows changed';
  assert (select count(*) from public.profiles) = (select profiles from _rows), 'profiles rows changed';
  assert (select count(*) from public.profile_versions) = (select versions from _rows), 'profile_versions rows changed';
  assert (select count(*) from public.audit_log) = (select audit from _rows), 'audit_log rows changed';
end $$;

-- nothing is dropped for real: undo the test transaction
rollback;

do $$ begin
  assert (select count(*) from pg_tables where schemaname = 'public' and tablename like 'compliance\_%') = 4, 'the test must not drop anything';
end $$;

select 'COMPLIANCE ROLLBACK CHECK PASSED' as result;
