-- Purpose: a team member marks exactly one of their internal profiles as PRIMARY: the one managers see and use.
--
-- * profiles.is_primary, with a unique partial index: at most one primary per owner.
-- * Nobody writes is_primary directly: signed-in users get no INSERT or UPDATE privilege on the column (the table-wide
--   INSERT grant becomes a column list without it), and a trigger only lets a profile's OWNER change it, so even an
--   admin (profiles_admin_all) cannot set someone else's primary.
-- * set_primary_profile(id): the owner switches their primary atomically (locks their profiles, clears the old one,
--   sets the new one, in one transaction).
-- * submit_profile_version(...): what Submit calls. Saves the version through save_profile_version (unchanged, still
--   runs as the caller) and, in the same transaction, makes the profile primary when asked (p_make_primary) or when
--   the owner has no primary yet (their first submitted profile). Saving a new version never moves the primary
--   elsewhere: the primary is a profile, and managers always see its current (newest) version.
-- * search_profiles_by_name: ONE row per team member: their primary profile, or their most recently updated one when
--   none is marked. A name matches if any of their profiles matches. Same role check, limits and matching as before.
-- No backfill: existing users have no primary until they mark one or submit.

alter table public.profiles add column is_primary boolean not null default false;

create unique index profiles_one_primary_per_owner on public.profiles (owner_id) where is_primary;

-- No direct writes to is_primary (UPDATE was already a column list without it).
revoke insert on public.profiles from authenticated;
grant insert (id, owner_id, template, candidate_name, current_version_id, archived, created_at, updated_at)
  on public.profiles to authenticated;

-- Only the owner may change a profile's primary flag (also inside set_primary_profile: auth.uid() is the caller there
-- too). Without a signed-in user (migrations, the SQL editor) the change is allowed.
create function public.guard_profile_primary() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.is_primary is distinct from old.is_primary
     and auth.uid() is not null and auth.uid() is distinct from old.owner_id then
    raise exception 'Only the owner can choose their primary profile' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_primary_guard before update on public.profiles
  for each row execute function public.guard_profile_primary();
revoke all on function public.guard_profile_primary() from public, anon;

-- The caller makes one of their own internal, non-archived profiles primary. Atomic: one transaction.
create function public.set_primary_profile(p_profile_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  -- Lock every profile of the caller first, so two switches at once run one after the other.
  perform 1 from public.profiles where owner_id = v_uid for update;
  select id, owner_id, template, archived, is_primary into v_row from public.profiles where id = p_profile_id;
  if v_row.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if v_row.owner_id <> v_uid then
    raise exception 'Only the owner can choose their primary profile' using errcode = '42501';
  end if;
  if v_row.template <> 'internal' or v_row.archived then
    raise exception 'Only an active internal profile can be primary' using errcode = '22023';
  end if;
  if v_row.is_primary then
    return;
  end if;
  update public.profiles set is_primary = false where owner_id = v_uid and is_primary;
  update public.profiles set is_primary = true where id = p_profile_id;
  insert into public.audit_log (actor_id, action, entity, entity_id) values (v_uid, 'set_primary', 'profile', p_profile_id);
end;
$$;

-- Submit: save the version and (when asked, or when the owner has no primary yet) make the profile primary, in one step.
create function public.submit_profile_version(
  p_profile_id   uuid,
  p_template     public.template_kind,
  p_kind         public.version_kind,
  p_label        text,
  p_parent       uuid,
  p_source       text,
  p_profile      jsonb,
  p_flags        jsonb,
  p_analysis     jsonb,
  p_prompt_plan  text[],
  p_make_primary boolean
) returns table (new_version_id uuid, new_version_no int, profile_id uuid, is_primary boolean)
language plpgsql security invoker set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_vid uuid;
  v_no  int;
  v_pid uuid;
begin
  select s.new_version_id, s.new_version_no into v_vid, v_no
  from public.save_profile_version(p_profile_id, p_template, p_kind, p_label, p_parent, p_source, p_profile, p_flags,
                                   p_analysis, p_prompt_plan) as s;
  select v.profile_id into v_pid from public.profile_versions v where v.id = v_vid;
  if p_template = 'internal' and (
    coalesce(p_make_primary, false)
    or not exists (select 1 from public.profiles p where p.owner_id = auth.uid() and p.is_primary and not p.archived)
  ) then
    perform public.set_primary_profile(v_pid);
  end if;
  return query select v_vid, v_no, v_pid, p.is_primary from public.profiles p where p.id = v_pid;
end;
$$;

revoke all on function public.set_primary_profile(uuid) from public, anon;
grant execute on function public.set_primary_profile(uuid) to authenticated;
revoke all on function public.submit_profile_version(uuid, public.template_kind, public.version_kind, text, uuid, text, jsonb, jsonb, jsonb, text[], boolean) from public, anon;
grant execute on function public.submit_profile_version(uuid, public.template_kind, public.version_kind, text, uuid, text, jsonb, jsonb, jsonb, text[], boolean) to authenticated;

-- One row per team member (the return type changes, so the function is dropped and created again).
drop function public.search_profiles_by_name(text);

create function public.search_profiles_by_name(p_query text)
returns table (
  id            uuid,
  template      public.template_kind,
  candidate_name text,
  owner_id      uuid,
  owner_name    text,
  owner_email   text,
  version_count int,
  updated_at    timestamptz,
  score         real,
  is_primary    boolean
)
language plpgsql stable security invoker
set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  q_prefix text;   -- LIKE pattern: starts with q
  q_word text;     -- LIKE pattern: a later word starts with q
begin
  if public.current_app_role() is null or public.current_app_role() not in ('manager', 'admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(q) > 100 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;

  -- Escape LIKE wildcards so "50%" or "a_b" are matched literally.
  q_prefix := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  q_word := '% ' || q_prefix;

  return query
  with live as (
    select p.id, p.template, p.candidate_name, p.owner_id, p.updated_at, p.is_primary
    from public.profiles p
    where not p.archived and p.template = 'internal'
  ),
  -- the best match over ALL of a person's profiles
  matched as (
    select l.owner_id,
           max(case when q = '' then 0::real
                    when l.candidate_name ilike q_prefix or l.candidate_name ilike q_word then
                      greatest(word_similarity(q, l.candidate_name), 0.9)::real
                    else word_similarity(q, l.candidate_name)
               end) as score
    from live l
    where q = ''
       or l.candidate_name ilike q_prefix
       or l.candidate_name ilike q_word
       or word_similarity(q, l.candidate_name) >= 0.35
       or (
         length(q) >= 4
         and word_similarity(q, l.candidate_name) >= 0.2
         and exists (
           select 1 from regexp_split_to_table(lower(l.candidate_name), '\s+') as w
           where left(w, 1) = left(lower(q), 1)
         )
       )
    group by l.owner_id
  ),
  -- the profile shown for each person: the primary one, else the most recently updated
  shown as (
    select distinct on (l.owner_id) l.*
    from live l
    order by l.owner_id, l.is_primary desc, l.updated_at desc, l.id
  )
  select s.id, s.template, s.candidate_name, s.owner_id, u.full_name, u.email,
         (select count(*)::int from public.profile_versions v where v.profile_id = s.id),
         s.updated_at, m.score, s.is_primary
  from shown s
  join matched m on m.owner_id = s.owner_id
  left join public.app_users u on u.id = s.owner_id
  order by m.score desc, s.updated_at desc
  limit 50;
end;
$$;

revoke all on function public.search_profiles_by_name(text) from public, anon;
grant execute on function public.search_profiles_by_name(text) to authenticated;
