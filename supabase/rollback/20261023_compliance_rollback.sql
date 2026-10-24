-- Rollback for the compliance registry migrations (20261023120000, 20261023120100, 20261023120200).
-- NOT a migration: it lives outside supabase/migrations on purpose, so no tool ever runs it automatically.
-- Run it by hand only if the feature must be removed. First set COMPLIANCE_ENFORCE=off in the app (instant, no DB change).
--
-- Removes ONLY the compliance objects: 4 tables, 6 functions, 4 trigger functions. Their indexes, policies, triggers and
-- constraints go with the tables. No CASCADE is used, so if anything else ever came to depend on these objects the script
-- fails and rolls back instead of dropping it. profiles, profile_versions, app_users, app_settings and every other
-- table are untouched. audit_log rows written by the registry (actions compliance_*) are kept: audit_log is append-only.
-- After running it, delete the three versions from supabase_migrations.schema_migrations if they were recorded there.
--
-- HOW TO RUN (as ONE transaction, so it is all-or-nothing): `psql -1 -v ON_ERROR_STOP=1 -f 20261023_compliance_rollback.sql`,
-- or paste the whole file into the Supabase SQL editor and run it once. Deliberately has no begin/commit of its own, so
-- supabase/tests/004_compliance_rollback.sql can run it inside a transaction it then rolls back.

drop function if exists public.compliance_review_name(uuid, text, text);
drop function if exists public.compliance_registry_names();
drop function if exists public.compliance_scheduler_state(date);
drop function if exists public.compliance_finish_run(uuid, text, integer, integer, integer, jsonb, jsonb, text, text);
drop function if exists public.compliance_apply_snapshot(uuid, jsonb);
drop function if exists public.compliance_begin_run(text, uuid, date);

drop table if exists public.compliance_name_sources;
drop table if exists public.compliance_names;
drop table if exists public.compliance_sync_runs;
drop table if exists public.compliance_settings;

drop function if exists public.compliance_reject_delete();
drop function if exists public.compliance_guard_names();
drop function if exists public.compliance_guard_sources();
drop function if exists public.compliance_guard_runs();

