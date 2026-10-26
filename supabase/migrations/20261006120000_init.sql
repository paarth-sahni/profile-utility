-- Purpose: TASK-02 initial schema. Normalised profile storage with immutable versions, review and
-- audit tables, and the save/get functions. Row Level Security is ENABLED on every table here
-- (default deny); the per-role policies are added in the next migration.
-- All schema changes go through migrations; never edit the database from the dashboard.

------------------------------------------------------------------------------------------------
-- Extensions (Supabase installs them in the `extensions` schema)
------------------------------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions; -- no vector columns yet (JD search)

------------------------------------------------------------------------------------------------
-- Types
------------------------------------------------------------------------------------------------
create type public.app_role as enum ('team_member', 'checker', 'manager', 'admin');
create type public.template_kind as enum ('internal', 'external');
create type public.version_kind as enum ('base', 'role_specific');
create type public.review_status as enum ('pending', 'approved', 'changes_requested');
-- skill_plain = external-profile skills, which have no rating
create type public.list_kind as enum ('certification', 'tool', 'domain', 'language', 'managerial', 'skill_plain');

------------------------------------------------------------------------------------------------
-- Settings (read only by security-definer code; no policies, so unreachable from the API)
------------------------------------------------------------------------------------------------
create table public.app_settings (
  key   text primary key,
  value text not null
);
-- AUTH_ALLOWED_DOMAIN lives here because SQL cannot read the app's environment.
insert into public.app_settings (key, value) values
  ('allowed_domain', 'infobeans.com'),
  ('allow_example_test', 'off'); -- seed-only exception; seed.sql switches it on, then off again

------------------------------------------------------------------------------------------------
-- Users
------------------------------------------------------------------------------------------------
create table public.app_users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       public.app_role not null default 'team_member',
  created_at timestamptz not null default now()
);

-- Creates the app_users row for every new auth user and rejects emails outside the allowed domain.
create function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_domain  text := lower(split_part(new.email, '@', 2));
  v_allowed text := (select lower(value) from public.app_settings where key = 'allowed_domain');
  v_test_ok boolean := coalesce((select value = 'on' from public.app_settings where key = 'allow_example_test'), false);
begin
  if v_domain is distinct from v_allowed and not (v_test_ok and v_domain = 'example.test') then
    raise exception 'Email domain is not allowed' using errcode = '42501';
  end if;
  insert into public.app_users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Role of the calling user. security definer so policies can use it without recursing into app_users RLS.
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.app_users where id = auth.uid();
$$;

------------------------------------------------------------------------------------------------
-- Profiles and versions
------------------------------------------------------------------------------------------------
-- No unique (owner, template): an external profile is about a candidate, and one person produces many.
create table public.profiles (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.app_users (id),
  template           public.template_kind not null,
  candidate_name     text not null default '',
  current_version_id uuid,
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Immutable: a change is always a new version with new child rows. Holds the single-value fields.
create table public.profile_versions (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  version_no        int not null check (version_no >= 1),
  kind              public.version_kind not null,
  label             text not null default '',
  parent_version_id uuid references public.profile_versions (id) on delete set null,
  source            text not null check (source in ('upload', 'scratch', 'edit')),
  created_by        uuid not null references public.app_users (id),
  created_at        timestamptz not null default now(),
  name              text not null default '',
  job_title         text not null default '',
  experience_summary text not null default '',
  specialization    text not null default '',
  overview          text not null default '',
  analysis          jsonb,       -- display only, never searched
  prompt_plan       text[],      -- display only, never searched
  search            tsvector,    -- built by save_profile_version from the version's text
  unique (profile_id, version_no)
);

alter table public.profiles
  add constraint profiles_current_version_fk
  foreign key (current_version_id) references public.profile_versions (id) on delete set null;

------------------------------------------------------------------------------------------------
-- Child tables (every item is a row with a 1-based position; all cascade from their parent)
------------------------------------------------------------------------------------------------
create table public.version_education (        -- 0 or 1 row per version
  version_id    uuid primary key references public.profile_versions (id) on delete cascade,
  year          text not null default '',
  qualification text not null default ''
);

create table public.version_projects (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references public.profile_versions (id) on delete cascade,
  position     int not null check (position >= 1),
  project_name text not null default '',     -- internal: project title; external: client name
  duration     text not null default '',
  team_size    text not null default '',     -- text so ranges like "2-3" survive
  role         text not null default '',
  project_link text not null default '',     -- internal only; '' for external
  description  text not null default '',
  unique (version_id, position)
);

create table public.project_technologies (
  project_id uuid not null references public.version_projects (id) on delete cascade,
  position   int not null check (position >= 1),
  name       text not null default '',
  primary key (project_id, position)
);

create table public.project_responsibilities (
  project_id uuid not null references public.version_projects (id) on delete cascade,
  position   int not null check (position >= 1),
  text       text not null default '',
  primary key (project_id, position)
);

create table public.version_skills (            -- internal, rated
  version_id uuid not null references public.profile_versions (id) on delete cascade,
  position   int not null check (position >= 1),
  name       text not null default '',
  -- text so "4" and "4.0" round-trip exactly; a number from 0 to 5 when present
  rating     text check (
    rating is null
    or (case when rating ~ '^[0-9]+(\.[0-9]+)?$' then rating::numeric <= 5 else false end)
  ),
  primary key (version_id, position)
);

create table public.version_list_items (
  version_id uuid not null references public.profile_versions (id) on delete cascade,
  kind       public.list_kind not null,
  position   int not null check (position >= 1),
  value      text not null default '',
  primary key (version_id, kind, position)
);

create table public.version_experience (        -- external only
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.profile_versions (id) on delete cascade,
  position       int not null check (position >= 1),
  company        text not null default '',
  position_title text not null default '',
  duration       text not null default '',
  unique (version_id, position)
);

create table public.experience_highlights (
  experience_id uuid not null references public.version_experience (id) on delete cascade,
  position      int not null check (position >= 1),
  text          text not null default '',
  primary key (experience_id, position)
);

create table public.version_review_flags (      -- the "Please double-check" list
  version_id uuid not null references public.profile_versions (id) on delete cascade,
  position   int not null check (position >= 1),
  path       text not null default '',
  reason     text not null default '',
  primary key (version_id, position)
);

------------------------------------------------------------------------------------------------
-- Review (used from TASK-04) and audit
------------------------------------------------------------------------------------------------
create table public.checker_reviews (
  id         uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.profile_versions (id) on delete cascade,
  checker_id uuid not null references public.app_users (id),
  status     public.review_status not null default 'pending',
  comment    text not null default '',
  created_at timestamptz not null default now()
);

create table public.review_items (
  id        uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.checker_reviews (id) on delete cascade,
  path      text not null default '',
  reason    text not null default '',
  resolved  boolean not null default false
);

-- Metadata only, insert-only. actor_id has no FK so the trail outlives a deleted user.
create table public.audit_log (
  id        bigint generated always as identity primary key,
  actor_id  uuid,
  action    text not null,
  entity    text not null,
  entity_id uuid,
  at        timestamptz not null default now()
);

------------------------------------------------------------------------------------------------
-- Indexes (FK indexes keep the RLS joins cheap; the rest are ready for search)
------------------------------------------------------------------------------------------------
create index profiles_owner_idx            on public.profiles (owner_id);
create index profiles_name_trgm_idx        on public.profiles using gin (candidate_name extensions.gin_trgm_ops);
create index profile_versions_profile_idx  on public.profile_versions (profile_id);
create index profile_versions_parent_idx   on public.profile_versions (parent_version_id);
create index profile_versions_search_idx   on public.profile_versions using gin (search);
create index version_projects_version_idx  on public.version_projects (version_id);
create index version_experience_version_idx on public.version_experience (version_id);
create index version_skills_name_idx       on public.version_skills (lower(name));
create index project_technologies_name_idx on public.project_technologies (lower(name));
create index version_list_items_kind_idx   on public.version_list_items (kind, lower(value));
create index checker_reviews_version_idx   on public.checker_reviews (version_id);
create index review_items_review_idx       on public.review_items (review_id);

------------------------------------------------------------------------------------------------
-- Immutability: UPDATE is rejected on versions and every child table, for every role.
------------------------------------------------------------------------------------------------
create function public.reject_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception '% rows are immutable; save a new version instead', tg_table_name using errcode = '42501';
end;
$$;

-- profile_versions has one carve-out: the FK action "on delete set null" for parent_version_id is an
-- UPDATE. Only nulling that one column is allowed; anything else is rejected.
create function public.reject_version_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.parent_version_id is not null
     or (to_jsonb(new) - 'parent_version_id') is distinct from (to_jsonb(old) - 'parent_version_id') then
    raise exception 'profile_versions rows are immutable; save a new version instead' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profile_versions_immutable before update on public.profile_versions
  for each row execute function public.reject_version_update();

do $$
declare t text;
begin
  foreach t in array array[
    'version_education', 'version_projects', 'project_technologies', 'project_responsibilities',
    'version_skills', 'version_list_items', 'version_experience', 'experience_highlights',
    'version_review_flags'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.reject_update()',
                   t || '_immutable', t);
  end loop;
end $$;

-- audit_log is insert-only: no UPDATE, no DELETE.
create function public.reject_audit_change() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'audit_log is insert-only' using errcode = '42501';
end;
$$;
create trigger audit_log_insert_only before update or delete on public.audit_log
  for each row execute function public.reject_audit_change();

------------------------------------------------------------------------------------------------
-- Functions
------------------------------------------------------------------------------------------------
-- Returns j if it is a JSON array, else an empty array (keeps the save function tolerant).
create function public._jarr(j jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end;
$$;

-- Saves a new immutable version in ONE transaction (the function call): creates the profile if
-- needed, inserts the version with the next version_no, inserts every child row in order, builds
-- `search`, updates current_version_id/candidate_name, writes the audit row.
-- security invoker: Row Level Security applies to every statement as the calling user.
create function public.save_profile_version(
  p_profile_id  uuid,
  p_template    public.template_kind,
  p_kind        public.version_kind,
  p_label       text,
  p_parent      uuid,
  p_source      text,
  p_profile     jsonb,
  p_flags       jsonb,
  p_analysis    jsonb,
  p_prompt_plan text[]
) returns table (new_version_id uuid, new_version_no int)
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_name    text;
  v_no      int;
  v_vid     uuid;
  v_pid     uuid;
  v_eid     uuid;
  v_search  tsvector;
  r         record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Profile must be a JSON object' using errcode = '22023';
  end if;
  if jsonb_array_length(public._jarr(p_profile -> 'education')) > 1 then
    raise exception 'At most one education entry is allowed' using errcode = '22023';
  end if;

  v_name := coalesce(p_profile ->> 'name', '');

  -- Create the profile, or lock the existing one. The lock serialises concurrent saves so
  -- version_no stays sequential. RLS hides profiles the caller may not write.
  if p_profile_id is null then
    insert into public.profiles (owner_id, template, candidate_name)
    values (v_uid, p_template, v_name)
    returning id into v_profile;
  else
    select id into v_profile from public.profiles
    where id = p_profile_id and template = p_template
    for update;
    if v_profile is null then
      raise exception 'Profile not found' using errcode = 'P0002';
    end if;
  end if;

  if p_parent is not null and not exists (
    select 1 from public.profile_versions where id = p_parent and profile_id = v_profile
  ) then
    raise exception 'Parent version not found on this profile' using errcode = 'P0002';
  end if;
  if p_kind = 'role_specific' and p_parent is null then
    raise exception 'A role-specific version needs a parent version' using errcode = '22023';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_no
  from public.profile_versions where profile_id = v_profile;

  -- Full-text document: name and job title weighted highest, then every other string in the profile.
  select setweight(to_tsvector('simple', v_name || ' ' || coalesce(p_profile ->> 'jobTitle', '')), 'A')
         || to_tsvector('simple', coalesce(string_agg(s #>> '{}', ' '), ''))
  into v_search
  from jsonb_path_query(p_profile, 'strict $.** ? (@.type() == "string")') as s;

  insert into public.profile_versions (
    profile_id, version_no, kind, label, parent_version_id, source, created_by,
    name, job_title, experience_summary, specialization, overview,
    analysis, prompt_plan, search
  ) values (
    v_profile, v_no, p_kind, coalesce(p_label, ''), p_parent, p_source, v_uid,
    v_name,
    coalesce(p_profile ->> 'jobTitle', ''),
    coalesce(p_profile ->> 'experienceSummary', ''),
    coalesce(p_profile ->> 'specialization', ''),
    coalesce(p_profile ->> 'overview', ''),
    p_analysis, p_prompt_plan, v_search
  ) returning id into v_vid;

  -- Education (0 or 1 row)
  insert into public.version_education (version_id, year, qualification)
  select v_vid, coalesce(e ->> 'year', ''), coalesce(e ->> 'qualification', '')
  from jsonb_array_elements(public._jarr(p_profile -> 'education')) as e;

  -- Projects, each with its technologies (internal) and responsibilities
  for r in
    select e.value as pj, e.ordinality::int as ord
    from jsonb_array_elements(public._jarr(p_profile -> 'projects')) with ordinality as e
  loop
    insert into public.version_projects (
      version_id, position, project_name, duration, team_size, role, project_link, description
    ) values (
      v_vid, r.ord,
      coalesce(case when p_template = 'internal' then r.pj ->> 'title' else r.pj ->> 'client' end, ''),
      coalesce(r.pj ->> 'duration', ''),
      coalesce(r.pj ->> 'teamSize', ''),
      coalesce(r.pj ->> 'role', ''),
      coalesce(case when p_template = 'internal' then r.pj ->> 'projectLink' else '' end, ''),
      coalesce(r.pj ->> 'description', '')
    ) returning id into v_pid;

    if p_template = 'internal' then
      insert into public.project_technologies (project_id, position, name)
      select v_pid, t.ordinality::int, t.value
      from jsonb_array_elements_text(public._jarr(r.pj -> 'toolsAndTechnologies')) with ordinality as t;
    end if;

    insert into public.project_responsibilities (project_id, position, text)
    select v_pid, t.ordinality::int, t.value
    from jsonb_array_elements_text(public._jarr(r.pj -> 'responsibilities')) with ordinality as t;
  end loop;

  -- Internal rated skills. An empty rating is stored as NULL and rebuilt as ''.
  if p_template = 'internal' then
    insert into public.version_skills (version_id, position, name, rating)
    select v_vid, e.ordinality::int, coalesce(e.value ->> 'name', ''), nullif(e.value ->> 'rating', '')
    from jsonb_array_elements(public._jarr(p_profile -> 'skills')) with ordinality as e;
  end if;

  -- Plain lists
  insert into public.version_list_items (version_id, kind, position, value)
  select v_vid, k.kind::public.list_kind, e.ordinality::int, e.value
  from (values
    ('certification', 'certifications',      'both'),
    ('tool',          'tools',               'both'),
    ('skill_plain',   'skills',              'external'),
    ('domain',        'domains',             'internal'),
    ('language',      'languages',           'internal'),
    ('managerial',    'managerialExperience', 'internal')
  ) as k(kind, key, scope)
  cross join lateral jsonb_array_elements_text(public._jarr(p_profile -> k.key)) with ordinality as e
  where k.scope = 'both' or k.scope = p_template::text;

  -- External employment history, each with its highlights
  if p_template = 'external' then
    for r in
      select e.value as ex, e.ordinality::int as ord
      from jsonb_array_elements(public._jarr(p_profile -> 'experience')) with ordinality as e
    loop
      insert into public.version_experience (version_id, position, company, position_title, duration)
      values (
        v_vid, r.ord,
        coalesce(r.ex ->> 'company', ''),
        coalesce(r.ex ->> 'position', ''),
        coalesce(r.ex ->> 'duration', '')
      ) returning id into v_eid;

      insert into public.experience_highlights (experience_id, position, text)
      select v_eid, t.ordinality::int, t.value
      from jsonb_array_elements_text(public._jarr(r.ex -> 'highlights')) with ordinality as t;
    end loop;
  end if;

  -- Review flags (kept even when some are still open)
  insert into public.version_review_flags (version_id, position, path, reason)
  select v_vid, e.ordinality::int, coalesce(e.value ->> 'path', ''), coalesce(e.value ->> 'reason', '')
  from jsonb_array_elements(public._jarr(p_flags)) with ordinality as e;

  update public.profiles
  set current_version_id = v_vid, candidate_name = v_name, updated_at = now()
  where id = v_profile;

  insert into public.audit_log (actor_id, action, entity, entity_id)
  values (v_uid, 'save_version', 'profile_version', v_vid);

  return query select v_vid, v_no;
end;
$$;

-- Rebuilds a saved version in EXACTLY the lib/schemas.ts shape for its template, in position order.
-- Returns { template, data, reviewFlags, analysis, promptPlan, meta }, or NULL if the version does not
-- exist or is not visible to the caller. security invoker: RLS applies.
create function public.get_profile_version(p_version_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v public.profile_versions;
  p public.profiles;
  v_data jsonb;
  v_education jsonb;
  v_projects jsonb;
begin
  select * into v from public.profile_versions where id = p_version_id;
  if not found then return null; end if;
  select * into p from public.profiles where id = v.profile_id;
  if not found then return null; end if;

  -- no education row rebuilds as the single blank entry the forms expect
  select coalesce(
    (select jsonb_agg(jsonb_build_object('year', e.year, 'qualification', e.qualification))
     from public.version_education e where e.version_id = v.id),
    jsonb_build_array(jsonb_build_object('year', '', 'qualification', ''))
  ) into v_education;

  if p.template = 'internal' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'duration', pr.duration,
      'title', pr.project_name,
      'toolsAndTechnologies', coalesce((select jsonb_agg(t.name order by t.position)
                                        from public.project_technologies t where t.project_id = pr.id), '[]'::jsonb),
      'teamSize', pr.team_size,
      'role', pr.role,
      'projectLink', pr.project_link,
      'description', pr.description,
      'responsibilities', coalesce((select jsonb_agg(x.text order by x.position)
                                    from public.project_responsibilities x where x.project_id = pr.id), '[]'::jsonb)
    ) order by pr.position), '[]'::jsonb) into v_projects
    from public.version_projects pr where pr.version_id = v.id;

    v_data := jsonb_build_object(
      'name', v.name, 'jobTitle', v.job_title, 'experienceSummary', v.experience_summary,
      'specialization', v.specialization, 'overview', v.overview,
      'education', v_education,
      'projects', v_projects,
      'skills', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'rating', coalesce(s.rating, ''))
                                           order by s.position)
                          from public.version_skills s where s.version_id = v.id), '[]'::jsonb)
    );
    v_data := v_data || (
      select jsonb_object_agg(k.key, coalesce((select jsonb_agg(l.value order by l.position)
                                               from public.version_list_items l
                                               where l.version_id = v.id and l.kind = k.kind::public.list_kind),
                                              '[]'::jsonb))
      from (values ('certification', 'certifications'), ('tool', 'tools'), ('managerial', 'managerialExperience'),
                   ('domain', 'domains'), ('language', 'languages')) as k(kind, key)
    );
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'duration', pr.duration,
      'client', pr.project_name,
      'teamSize', pr.team_size,
      'role', pr.role,
      'description', pr.description,
      'responsibilities', coalesce((select jsonb_agg(x.text order by x.position)
                                    from public.project_responsibilities x where x.project_id = pr.id), '[]'::jsonb)
    ) order by pr.position), '[]'::jsonb) into v_projects
    from public.version_projects pr where pr.version_id = v.id;

    v_data := jsonb_build_object(
      'name', v.name, 'jobTitle', v.job_title, 'experienceSummary', v.experience_summary,
      'specialization', v.specialization, 'overview', v.overview,
      'education', v_education,
      'projects', v_projects,
      'experience', coalesce((select jsonb_agg(jsonb_build_object(
                                'company', ex.company, 'position', ex.position_title, 'duration', ex.duration,
                                'highlights', coalesce((select jsonb_agg(h.text order by h.position)
                                                        from public.experience_highlights h where h.experience_id = ex.id),
                                                       '[]'::jsonb)
                              ) order by ex.position)
                             from public.version_experience ex where ex.version_id = v.id), '[]'::jsonb)
    );
    v_data := v_data || (
      select jsonb_object_agg(k.key, coalesce((select jsonb_agg(l.value order by l.position)
                                               from public.version_list_items l
                                               where l.version_id = v.id and l.kind = k.kind::public.list_kind),
                                              '[]'::jsonb))
      from (values ('skill_plain', 'skills'), ('tool', 'tools'), ('certification', 'certifications')) as k(kind, key)
    );
  end if;

  return jsonb_build_object(
    'template', p.template,
    'data', v_data,
    'reviewFlags', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'reason', f.reason) order by f.position)
                             from public.version_review_flags f where f.version_id = v.id), '[]'::jsonb),
    'analysis', v.analysis,
    'promptPlan', to_jsonb(coalesce(v.prompt_plan, '{}'::text[])),
    'meta', jsonb_build_object(
      'profileId', v.profile_id, 'versionId', v.id, 'versionNo', v.version_no, 'kind', v.kind,
      'label', v.label, 'parentVersionId', v.parent_version_id, 'source', v.source, 'createdAt', v.created_at
    )
  );
end;
$$;

------------------------------------------------------------------------------------------------
-- Row Level Security: enabled on EVERY table now (no policy = no access). Policies come next.
------------------------------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

------------------------------------------------------------------------------------------------
-- Privileges: anon gets nothing; functions are not executable by anon or PUBLIC.
------------------------------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon, public;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.save_profile_version(uuid, public.template_kind, public.version_kind, text, uuid, text, jsonb, jsonb, jsonb, text[]) to authenticated;
grant execute on function public.get_profile_version(uuid) to authenticated;
grant execute on function public._jarr(jsonb) to authenticated;
