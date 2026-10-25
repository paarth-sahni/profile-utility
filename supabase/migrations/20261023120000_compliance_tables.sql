-- Purpose: reference registry for the client / company / project-name compliance check (file 1 of 3: tables only).
--
-- * compliance_names         one canonical row per matching identity (normalised name), with the name types it was seen as
--                            (client, legal, friendly, group; 'project' is allowed but no source supplies it yet).
-- * compliance_name_sources  every place a name was seen in the Google Sheet (tab, section 'list', column, row). History is kept.
-- * compliance_sync_runs     one row per synchronisation attempt. A partial unique index allows only ONE running run.
-- * compliance_settings      single row: schedule days, retry limit, staleness threshold.
--
-- ADDITIVE ONLY: creates new tables, indexes, policies and guard triggers. It alters no existing table, policy, trigger,
-- function or type, and inserts no rows. Safe to re-run (if not exists / drop-if-exists on NEW objects only).
-- Nothing is ever deleted from the registry: DELETE is rejected by trigger for every role, removal is `deactivated` only.
-- Access: only managers and admins may read names and sources, only admins may read runs and settings. Nobody signed in
-- can write: all writes go through the security-definer functions of file 2. service_role has NO table privilege either
-- (it only gets EXECUTE on the sync functions), so the sync key cannot be used to edit tables directly.
-- Free text columns are length-limited; no spreadsheet id and no cell other than the name itself is stored.
-- Rollback (outside this folder, never run automatically): supabase/rollback/20261023_compliance_rollback.sql
--
-- Status values are text + CHECK (not enum types) so this file needs no type guards and stays re-runnable.

begin;

------------------------------------------------------------------------------------------------
-- Synchronisation runs (created first: sources point at it)
------------------------------------------------------------------------------------------------
create table if not exists public.compliance_sync_runs (
  id                uuid primary key default gen_random_uuid(),
  trigger           text not null check (trigger in ('scheduled', 'manual')),
  -- no FK, like audit_log.actor_id: the history outlives a deleted user
  triggered_by      uuid,
  -- the day a scheduled run was meant for (groups the retries of one scheduled run); null for manual runs
  scheduled_for     date,
  attempt           integer not null default 1 check (attempt between 1 and 10),
  status            text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed')),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  tabs_discovered   integer not null default 0 check (tabs_discovered >= 0),
  tabs_scanned      integer not null default 0 check (tabs_scanned >= 0),
  tabs_failed       integer not null default 0 check (tabs_failed >= 0),
  names_new         integer not null default 0 check (names_new >= 0),
  names_updated     integer not null default 0 check (names_updated >= 0),
  occurrences_seen  integer not null default 0 check (occurrences_seen >= 0),
  missing_candidates integer not null default 0 check (missing_candidates >= 0),
  -- true only when every selected tab was read and parsed; only then may "missing from the sheet" be concluded
  snapshot_complete boolean not null default false,
  -- per-tab status and counts only (never cell contents)
  tab_report        jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tab_report) = 'array' and pg_column_size(tab_report) <= 65536),
  anomalies         jsonb not null default '[]'::jsonb
    check (jsonb_typeof(anomalies) = 'array' and pg_column_size(anomalies) <= 16384),
  error_code        text check (error_code is null or length(error_code) <= 64),
  error_summary     text check (error_summary is null or length(error_summary) <= 500),
  constraint compliance_runs_finished_iff_done check ((status = 'running') = (finished_at is null))
);

-- Only one run may be in progress at any time (database-level lock for scheduled, retried and manual runs alike).
create unique index if not exists compliance_one_running_run on public.compliance_sync_runs ((true)) where status = 'running';
create index if not exists compliance_runs_started_idx on public.compliance_sync_runs (started_at desc);
create index if not exists compliance_runs_scheduled_idx on public.compliance_sync_runs (scheduled_for) where scheduled_for is not null;
-- one attempt number per scheduled day
create unique index if not exists compliance_runs_attempt_per_day on public.compliance_sync_runs (scheduled_for, attempt)
  where scheduled_for is not null;

------------------------------------------------------------------------------------------------
-- Canonical names
------------------------------------------------------------------------------------------------
create table if not exists public.compliance_names (
  id                  uuid primary key default gen_random_uuid(),
  -- first spelling seen, for display
  display_name        text not null check (length(display_name) between 1 and 300),
  -- matching identity (see lib/compliance/normalize.ts): lower case tokens joined by single spaces
  normalized          text not null unique
    check (normalized <> '' and length(normalized) <= 300 and normalized = lower(btrim(normalized)) and normalized !~ '\s\s'),
  name_types          text[] not null
    check (cardinality(name_types) between 1 and 5
           and name_types <@ array['client', 'legal', 'friendly', 'group', 'project']::text[]),
  status              text not null default 'active' check (status in ('active', 'pending_removal_review', 'deactivated')),
  -- set when a COMPLETE run saw the name nowhere; the name stays enforced while it is pending review
  missing_since       timestamptz,
  -- an admin said "keep": do not flag again until the name has been seen in the sheet once more
  missing_acknowledged boolean not null default false,
  status_changed_by   uuid,
  status_changed_at   timestamptz,
  review_note         text check (review_note is null or length(review_note) <= 500),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint compliance_names_pending_has_missing check (status <> 'pending_removal_review' or missing_since is not null)
);

create index if not exists compliance_names_status_idx on public.compliance_names (status);

------------------------------------------------------------------------------------------------
-- Source occurrences (where each name was seen). Rows are never deleted; an occurrence that disappears is marked
-- currently_observed = false.
------------------------------------------------------------------------------------------------
create table if not exists public.compliance_name_sources (
  id               uuid primary key default gen_random_uuid(),
  name_id          uuid not null references public.compliance_names (id) on delete restrict,
  tab_name         text not null check (length(tab_name) between 1 and 100),
  -- the client list is ONE section, 'list'; 'clients' / 'projects' stay allowed for a future second source
  section          text not null check (section in ('list', 'clients', 'projects')),
  column_key       text not null check (column_key in
                     ('client_name', 'legal_name', 'friendly_name', 'client_group', 'new_client_name', 'new_project')),
  -- the cell text as written (latest sighting), and its 1-based row (informational: rows can shift)
  source_value     text not null check (length(source_value) between 1 and 300),
  source_row       integer check (source_row is null or source_row >= 1),
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_seen_run_id uuid references public.compliance_sync_runs (id) on delete restrict,
  currently_observed boolean not null default true,
  -- the same name in the same tab/column is ONE occurrence, so repeated runs never duplicate it
  constraint compliance_sources_identity unique (name_id, tab_name, section, column_key),
  -- a column can only appear in its own section
  constraint compliance_sources_section_column check (
    (section = 'list' and column_key in ('client_name', 'legal_name', 'friendly_name', 'client_group'))
    or (section = 'clients' and column_key in ('new_client_name', 'legal_name'))
    or (section = 'projects' and column_key in ('client_name', 'new_project'))
  )
);

create index if not exists compliance_sources_name_idx on public.compliance_name_sources (name_id);
create index if not exists compliance_sources_run_idx on public.compliance_name_sources (last_seen_run_id);
create index if not exists compliance_sources_observed_idx on public.compliance_name_sources (name_id) where currently_observed;

------------------------------------------------------------------------------------------------
-- Settings: exactly one row (id is always true)
------------------------------------------------------------------------------------------------
create table if not exists public.compliance_settings (
  id              boolean primary key default true check (id),
  -- days of the month a scheduled sync runs (1..28 so every month has them); default the 5th and 20th
  schedule_days   integer[] not null default array[5, 20]
    check (cardinality(schedule_days) between 1 and 8
           and schedule_days <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28]),
  max_attempts    integer not null default 4 check (max_attempts between 1 and 10),
  stale_after_days integer not null default 20 check (stale_after_days between 1 and 365),
  updated_at      timestamptz not null default now()
);

------------------------------------------------------------------------------------------------
-- Guard triggers: history cannot be rewritten or deleted, by any role (same idea as reject_update / audit_log).
------------------------------------------------------------------------------------------------
create or replace function public.compliance_reject_delete() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception '% rows are never deleted; deactivate instead', tg_table_name using errcode = '42501';
end;
$$;

create or replace function public.compliance_guard_names() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.normalized is distinct from old.normalized
     or new.created_at is distinct from old.created_at then
    raise exception 'A registry name keeps its identity' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.compliance_guard_sources() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.name_id is distinct from old.name_id
     or new.tab_name is distinct from old.tab_name or new.section is distinct from old.section
     or new.column_key is distinct from old.column_key or new.first_seen_at is distinct from old.first_seen_at then
    raise exception 'A source occurrence keeps its identity' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- A finished run is history: it cannot change again, and its origin never changes.
create or replace function public.compliance_guard_runs() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status <> 'running' then
    raise exception 'A finished sync run cannot be changed' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.trigger is distinct from old.trigger
     or new.triggered_by is distinct from old.triggered_by or new.scheduled_for is distinct from old.scheduled_for
     or new.attempt is distinct from old.attempt or new.started_at is distinct from old.started_at then
    raise exception 'The origin of a sync run cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists compliance_names_no_delete on public.compliance_names;
create trigger compliance_names_no_delete before delete on public.compliance_names
  for each row execute function public.compliance_reject_delete();
drop trigger if exists compliance_names_guard on public.compliance_names;
create trigger compliance_names_guard before update on public.compliance_names
  for each row execute function public.compliance_guard_names();

drop trigger if exists compliance_sources_no_delete on public.compliance_name_sources;
create trigger compliance_sources_no_delete before delete on public.compliance_name_sources
  for each row execute function public.compliance_reject_delete();
drop trigger if exists compliance_sources_guard on public.compliance_name_sources;
create trigger compliance_sources_guard before update on public.compliance_name_sources
  for each row execute function public.compliance_guard_sources();

drop trigger if exists compliance_runs_no_delete on public.compliance_sync_runs;
create trigger compliance_runs_no_delete before delete on public.compliance_sync_runs
  for each row execute function public.compliance_reject_delete();
drop trigger if exists compliance_runs_guard on public.compliance_sync_runs;
create trigger compliance_runs_guard before update on public.compliance_sync_runs
  for each row execute function public.compliance_guard_runs();

-- Trigger functions are not callable by anyone.
revoke all on function public.compliance_reject_delete() from public, anon, authenticated, service_role;
revoke all on function public.compliance_guard_names() from public, anon, authenticated, service_role;
revoke all on function public.compliance_guard_sources() from public, anon, authenticated, service_role;
revoke all on function public.compliance_guard_runs() from public, anon, authenticated, service_role;

------------------------------------------------------------------------------------------------
-- Row Level Security and least-privilege grants. Explicit revokes: this does not rely on default privileges.
------------------------------------------------------------------------------------------------
alter table public.compliance_names        enable row level security;
alter table public.compliance_name_sources enable row level security;
alter table public.compliance_sync_runs    enable row level security;
alter table public.compliance_settings     enable row level security;

revoke all on public.compliance_names, public.compliance_name_sources, public.compliance_sync_runs,
              public.compliance_settings from public, anon, authenticated, service_role;

-- Read only, and only for the roles that need it. No INSERT / UPDATE / DELETE / TRUNCATE grant exists for anyone.
grant select on public.compliance_names, public.compliance_name_sources to authenticated;
grant select on public.compliance_sync_runs, public.compliance_settings to authenticated;

drop policy if exists compliance_names_select_staff on public.compliance_names;
create policy compliance_names_select_staff on public.compliance_names for select to authenticated
  using ((select public.current_app_role()) in ('manager', 'admin'));

drop policy if exists compliance_sources_select_staff on public.compliance_name_sources;
create policy compliance_sources_select_staff on public.compliance_name_sources for select to authenticated
  using ((select public.current_app_role()) in ('manager', 'admin'));

drop policy if exists compliance_runs_select_admin on public.compliance_sync_runs;
create policy compliance_runs_select_admin on public.compliance_sync_runs for select to authenticated
  using ((select public.current_app_role()) = 'admin');

drop policy if exists compliance_settings_select_admin on public.compliance_settings;
create policy compliance_settings_select_admin on public.compliance_settings for select to authenticated
  using ((select public.current_app_role()) = 'admin');

commit;
