-- Purpose: the Preview step records a consent ("I confirm the information in this profile is accurate and may be
-- shared") in audit_log before a profile is submitted, downloaded or opened in Google Docs. A consent row needs to say
-- WHICH template and WHICH wording, so audit_log gets one small, optional `detail` column. Metadata only: never profile
-- content. audit_log stays insert-only (the no-update/no-delete trigger is untouched) and the insert policy (actor = caller) is
-- unchanged; the table-level INSERT grant already covers the new column.

alter table public.audit_log add column detail jsonb;

alter table public.audit_log
  add constraint audit_log_detail_small_object
  check (detail is null or (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 1024));
