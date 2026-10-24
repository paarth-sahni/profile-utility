-- Purpose: the ONLY way the compliance registry is written or read by the app (file 2 of 3: functions).
--
-- Service functions (security definer, EXECUTE for service_role only; signed-in users, anon and PUBLIC are revoked):
--   compliance_begin_run        starts a run: expires stale runs, enforces the single-running-run lock, the manual cooldown
--                               and the attempt limit, and records the start in audit_log.
--   compliance_apply_snapshot   applies one full snapshot of the sheet in ONE transaction (atomic activation): upserts names
--                               and occurrences, never deletes. Only when the snapshot is complete does it mark unseen
--                               occurrences and flag names seen nowhere as pending_removal_review (they stay enforced).
--   compliance_finish_run       closes the run; "succeeded" is refused unless the applied snapshot was complete.
--   compliance_registry_names   the names the profile check must enforce (active and pending review, never deactivated).
--   compliance_scheduler_state  the settings and the day's latest run, for the scheduled job (read-only).
-- Admin function (security definer, EXECUTE for signed-in users, role checked INSIDE: admin only):
--   compliance_review_name      keep / deactivate / reactivate a name. Audited. Removal is never automatic.
--
-- ADDITIVE ONLY: creates new functions. Existing objects are not changed. Re-runnable (create or replace).
-- Every function pins search_path, validates its input and ends with explicit revoke / grant, because on this stack new
-- functions in `public` are executable by `authenticated` by default.

begin;

------------------------------------------------------------------------------------------------
-- compliance_begin_run
------------------------------------------------------------------------------------------------
create or replace function public.compliance_begin_run(p_trigger text, p_triggered_by uuid, p_scheduled_for date)
returns table (run_id uuid, attempt integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_attempt integer := 1;
  v_max     integer;
  v_id      uuid;
begin
  if p_trigger is null or p_trigger not in ('scheduled', 'manual') then
    raise exception 'Unknown trigger' using errcode = '22023';
  end if;
  if p_trigger = 'manual' and p_triggered_by is null then
    raise exception 'A manual run needs the administrator who started it' using errcode = '22023';
  end if;

  select s.max_attempts into v_max from public.compliance_settings s where s.id;
  v_max := coalesce(v_max, 4);

  -- a run that has been "running" for 15 minutes died without finishing: close it so it cannot block every later run
  update public.compliance_sync_runs r
     set status = 'failed', finished_at = now(), error_code = 'STALE_RUN',
         error_summary = 'The run did not finish and was closed by the next run.'
   where r.status = 'running' and r.started_at < now() - interval '15 minutes';

  if p_trigger = 'manual' and exists (
    select 1 from public.compliance_sync_runs r
    where r.trigger = 'manual' and r.started_at > now() - interval '5 minutes'
  ) then
    raise exception 'A manual sync was started less than 5 minutes ago' using errcode = '54000';
  end if;

  if p_trigger = 'scheduled' then
    if p_scheduled_for is null then
      raise exception 'A scheduled run needs its day' using errcode = '22023';
    end if;
    -- a partial run (some tab failed) may be retried like a failed one; only a full success closes the day
    if exists (select 1 from public.compliance_sync_runs r
               where r.scheduled_for = p_scheduled_for and r.status = 'succeeded') then
      raise exception 'This scheduled day already succeeded' using errcode = '54000';
    end if;
    select coalesce(max(r.attempt), 0) + 1 into v_attempt
    from public.compliance_sync_runs r where r.scheduled_for = p_scheduled_for;
    if v_attempt > v_max then
      raise exception 'Retry limit reached for this scheduled day' using errcode = '54000';
    end if;
  end if;

  begin
    insert into public.compliance_sync_runs (trigger, triggered_by, scheduled_for, attempt)
    values (p_trigger, p_triggered_by, case when p_trigger = 'scheduled' then p_scheduled_for end, v_attempt)
    returning id into v_id;
  exception when unique_violation then
    -- the one-running-run index, or a concurrent attempt number
    raise exception 'A sync is already running' using errcode = '55006';
  end;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (p_triggered_by, 'compliance_sync_start', 'compliance_sync_run', v_id,
          jsonb_build_object('trigger', p_trigger, 'attempt', v_attempt));

  return query select v_id, v_attempt;
end;
$$;

------------------------------------------------------------------------------------------------
-- compliance_apply_snapshot
-- p_snapshot = { "complete": bool,
--                "names": [ { "normalized": text, "display": text, "types": [text],
--                             "occurrences": [ { "tab": text, "section": text, "column": text, "row": int, "value": text } ] } ] }
------------------------------------------------------------------------------------------------
create or replace function public.compliance_apply_snapshot(p_run_id uuid, p_snapshot jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run       public.compliance_sync_runs%rowtype;
  v_complete  boolean;
  v_names     jsonb;
  v_new       integer := 0;
  v_updated   integer := 0;
  v_occ       integer := 0;
  v_missing   integer := 0;
  v_reappeared_deactivated integer := 0;
begin
  select * into v_run from public.compliance_sync_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Sync run not found' using errcode = 'P0002';
  end if;
  if v_run.status <> 'running' then
    raise exception 'Sync run is not running' using errcode = '55000';
  end if;

  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Snapshot must be an object' using errcode = '22023';
  end if;
  v_names := p_snapshot -> 'names';
  if v_names is null or jsonb_typeof(v_names) <> 'array' then
    raise exception 'Snapshot needs a names list' using errcode = '22023';
  end if;
  if jsonb_typeof(p_snapshot -> 'complete') is distinct from 'boolean' then
    raise exception 'Snapshot needs a complete flag' using errcode = '22023';
  end if;
  v_complete := (p_snapshot ->> 'complete')::boolean;
  -- size caps: a runaway or hostile import cannot flood the registry
  if jsonb_array_length(v_names) > 20000 or pg_column_size(p_snapshot) > 16 * 1024 * 1024 then
    raise exception 'Snapshot is too large' using errcode = '22023';
  end if;

  -- a snapshot with no names cannot be "complete": it would make every name look as if it left the sheet
  if v_complete and jsonb_array_length(v_names) = 0 then
    raise exception 'An empty snapshot cannot be complete' using errcode = '22023';
  end if;

  drop table if exists pg_temp._cr_names;
  create temporary table _cr_names on commit drop as
    select (e ->> 'normalized')::text as normalized,
           (e ->> 'display')::text   as display,
           array(select jsonb_array_elements_text(e -> 'types')) as types,
           e -> 'occurrences'        as occurrences
    from jsonb_array_elements(v_names) as e;

  -- the builder merges identical names before sending; a repeat here means a broken snapshot, so refuse it whole
  if exists (select 1 from _cr_names group by normalized having count(*) > 1) then
    raise exception 'Snapshot lists the same name twice' using errcode = '22023';
  end if;

  -- 1. names: new ones are inserted; known ones only gain name types (spelling and status are kept)
  with up as (
    insert into public.compliance_names (display_name, normalized, name_types)
    select n.display, n.normalized, n.types from _cr_names n
    on conflict (normalized) do update
      set name_types = (select array_agg(distinct t order by t)
                        from unnest(public.compliance_names.name_types || excluded.name_types) as t),
          updated_at = case when public.compliance_names.name_types @> excluded.name_types
                            then public.compliance_names.updated_at else now() end
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted) into v_new, v_updated from up;

  -- 2. occurrences: the same name in the same tab/column stays ONE row; re-seeing it refreshes it
  with occ as (
    select cn.id as name_id,
           (o ->> 'tab')::text as tab_name, (o ->> 'section')::text as section, (o ->> 'column')::text as column_key,
           (o ->> 'value')::text as source_value, nullif(o ->> 'row', '')::integer as source_row
    from _cr_names n
    join public.compliance_names cn on cn.normalized = n.normalized
    cross join lateral jsonb_array_elements(n.occurrences) as o
  ), up as (
    insert into public.compliance_name_sources
      (name_id, tab_name, section, column_key, source_value, source_row, last_seen_run_id, currently_observed)
    select name_id, tab_name, section, column_key, source_value, source_row, p_run_id, true from occ
    on conflict (name_id, tab_name, section, column_key) do update
      set source_value = excluded.source_value, source_row = excluded.source_row, last_seen_at = now(),
          last_seen_run_id = p_run_id, currently_observed = true
    returning 1
  )
  select count(*) into v_occ from up;

  -- 3. a name seen again clears any "missing" mark (a deactivated name stays deactivated: only an admin reactivates it)
  update public.compliance_names cn
     set status = 'active', missing_since = null, missing_acknowledged = false, updated_at = now()
   where cn.id in (select cn2.id from _cr_names n join public.compliance_names cn2 on cn2.normalized = n.normalized)
     and (cn.status = 'pending_removal_review' or cn.missing_since is not null or cn.missing_acknowledged)
     and cn.status <> 'deactivated';
  update public.compliance_names cn set missing_since = null, missing_acknowledged = false
   where cn.status = 'deactivated' and (cn.missing_since is not null or cn.missing_acknowledged)
     and cn.id in (select cn2.id from _cr_names n join public.compliance_names cn2 on cn2.normalized = n.normalized);
  select count(*) into v_reappeared_deactivated
  from _cr_names n join public.compliance_names cn on cn.normalized = n.normalized where cn.status = 'deactivated';

  -- 4. ONLY for a complete snapshot: occurrences not seen this run are marked unobserved, and a name left with no observed
  --    occurrence anywhere is flagged for review. It stays enforced; nothing is removed.
  if v_complete then
    update public.compliance_name_sources s set currently_observed = false
     where s.currently_observed and s.last_seen_run_id is distinct from p_run_id;

    with flagged as (
      update public.compliance_names cn
         set status = 'pending_removal_review', missing_since = now(), updated_at = now()
       where cn.status = 'active' and not cn.missing_acknowledged
         and not exists (select 1 from public.compliance_name_sources s where s.name_id = cn.id and s.currently_observed)
      returning 1
    )
    select count(*) into v_missing from flagged;
  end if;

  update public.compliance_sync_runs
     set names_new = v_new, names_updated = v_updated, occurrences_seen = v_occ,
         missing_candidates = v_missing, snapshot_complete = v_complete
   where id = p_run_id;

  return jsonb_build_object('names_new', v_new, 'names_updated', v_updated, 'occurrences', v_occ,
                            'missing_candidates', v_missing, 'complete', v_complete,
                            'seen_again_but_deactivated', v_reappeared_deactivated);
end;
$$;

------------------------------------------------------------------------------------------------
-- compliance_finish_run
------------------------------------------------------------------------------------------------
create or replace function public.compliance_finish_run(
  p_run_id uuid, p_status text, p_tabs_discovered integer, p_tabs_scanned integer, p_tabs_failed integer,
  p_tab_report jsonb, p_anomalies jsonb, p_error_code text, p_error_summary text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_run public.compliance_sync_runs%rowtype;
begin
  if p_status is null or p_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'Unknown final status' using errcode = '22023';
  end if;
  select * into v_run from public.compliance_sync_runs where id = p_run_id for update;
  if v_run.id is null then
    raise exception 'Sync run not found' using errcode = 'P0002';
  end if;
  if v_run.status <> 'running' then
    raise exception 'Sync run is not running' using errcode = '55000';
  end if;
  -- "succeeded" is a claim that the whole sheet was read: only a complete snapshot may say so
  if p_status = 'succeeded' and not v_run.snapshot_complete then
    raise exception 'A run without a complete snapshot cannot succeed' using errcode = '22023';
  end if;

  update public.compliance_sync_runs
     set status = p_status, finished_at = now(),
         tabs_discovered = coalesce(p_tabs_discovered, 0), tabs_scanned = coalesce(p_tabs_scanned, 0),
         tabs_failed = coalesce(p_tabs_failed, 0),
         tab_report = coalesce(p_tab_report, '[]'::jsonb), anomalies = coalesce(p_anomalies, '[]'::jsonb),
         error_code = left(p_error_code, 64), error_summary = left(p_error_summary, 500)
   where id = p_run_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_run.triggered_by, 'compliance_sync', 'compliance_sync_run', p_run_id,
          jsonb_build_object('status', p_status, 'trigger', v_run.trigger, 'attempt', v_run.attempt));
end;
$$;

------------------------------------------------------------------------------------------------
-- compliance_registry_names: what the profile check enforces. Never deactivated names. Server-side use only.
------------------------------------------------------------------------------------------------
create or replace function public.compliance_registry_names()
returns table (id uuid, name text, types text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select n.id, n.display_name, n.name_types
  from public.compliance_names n
  where n.status in ('active', 'pending_removal_review')
  order by n.normalized;
$$;

------------------------------------------------------------------------------------------------
-- compliance_scheduler_state: what the scheduled job needs to decide whether to run today: the settings and the latest run
-- for that day. service_role has no table privilege, so this is its only way to read them. Read-only, no names, no cell values.
------------------------------------------------------------------------------------------------
create or replace function public.compliance_scheduler_state(p_day date)
returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'schedule_days', s.schedule_days,
    'max_attempts', s.max_attempts,
    'stale_after_days', s.stale_after_days,
    'last_run_for_day', (select jsonb_build_object('status', r.status, 'attempt', r.attempt, 'finished_at', r.finished_at, 'error_code', r.error_code)
                         from public.compliance_sync_runs r where r.scheduled_for = p_day order by r.attempt desc limit 1),
    'last_success_at', (select max(r.finished_at) from public.compliance_sync_runs r where r.status = 'succeeded')
  )
  from public.compliance_settings s where s.id;
$$;

------------------------------------------------------------------------------------------------
-- compliance_review_name: admin only (checked here, not just by hiding a button). Audited.
------------------------------------------------------------------------------------------------
create or replace function public.compliance_review_name(p_name_id uuid, p_decision text, p_note text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid  uuid := auth.uid();
  v_name public.compliance_names%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'Only an administrator can review registry names' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('keep', 'deactivate', 'reactivate') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'The note is too long' using errcode = '22023';
  end if;

  select * into v_name from public.compliance_names where id = p_name_id for update;
  if v_name.id is null then
    raise exception 'Name not found' using errcode = 'P0002';
  end if;

  if p_decision = 'keep' then
    if v_name.status <> 'pending_removal_review' then
      raise exception 'Only a name pending review can be kept' using errcode = '22023';
    end if;
    update public.compliance_names
       set status = 'active', missing_since = null, missing_acknowledged = true,
           status_changed_by = v_uid, status_changed_at = now(), review_note = p_note, updated_at = now()
     where id = p_name_id;
  elsif p_decision = 'deactivate' then
    if v_name.status = 'deactivated' then
      raise exception 'The name is already deactivated' using errcode = '22023';
    end if;
    update public.compliance_names
       set status = 'deactivated', status_changed_by = v_uid, status_changed_at = now(), review_note = p_note,
           updated_at = now()
     where id = p_name_id;
  else
    if v_name.status <> 'deactivated' then
      raise exception 'Only a deactivated name can be reactivated' using errcode = '22023';
    end if;
    update public.compliance_names
       set status = 'active', missing_since = null, missing_acknowledged = false,
           status_changed_by = v_uid, status_changed_at = now(), review_note = p_note, updated_at = now()
     where id = p_name_id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (v_uid, 'compliance_name_review', 'compliance_name', p_name_id, jsonb_build_object('decision', p_decision));
end;
$$;

------------------------------------------------------------------------------------------------
-- Privileges, explicit for every function
------------------------------------------------------------------------------------------------
revoke all on function public.compliance_begin_run(text, uuid, date) from public, anon, authenticated;
revoke all on function public.compliance_apply_snapshot(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.compliance_finish_run(uuid, text, integer, integer, integer, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.compliance_registry_names() from public, anon, authenticated;
revoke all on function public.compliance_scheduler_state(date) from public, anon, authenticated;
grant execute on function public.compliance_scheduler_state(date) to service_role;
grant execute on function public.compliance_begin_run(text, uuid, date) to service_role;
grant execute on function public.compliance_apply_snapshot(uuid, jsonb) to service_role;
grant execute on function public.compliance_finish_run(uuid, text, integer, integer, integer, jsonb, jsonb, text, text) to service_role;
grant execute on function public.compliance_registry_names() to service_role;

revoke all on function public.compliance_review_name(uuid, text, text) from public, anon;
grant execute on function public.compliance_review_name(uuid, text, text) to authenticated;

commit;
