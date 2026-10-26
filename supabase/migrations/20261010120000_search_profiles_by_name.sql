-- Purpose: TASK-02 step 5 (/manage). Name search for managers and admins using pg_trgm similarity.
-- security invoker, so Row Level Security still decides which rows are visible; the role check inside is a
-- second lock (errcode 42501 = insufficient privilege, which the app maps to 403). An empty query lists the
-- most recently updated profiles. Archived profiles are skipped. At most 50 rows.

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
  score         real
)
language plpgsql stable security invoker
set search_path = public, extensions, pg_temp as $$
#variable_conflict use_column
declare
  q text := btrim(coalesce(p_query, ''));
  pattern text;
begin
  if public.current_app_role() is null or public.current_app_role() not in ('manager', 'admin') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if length(q) > 100 then
    raise exception 'Search text is too long' using errcode = '22023';
  end if;

  -- Escape LIKE wildcards so "50%" or "a_b" are matched literally.
  pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select p.id, p.template, p.candidate_name, p.owner_id, u.full_name, u.email,
         (select count(*)::int from public.profile_versions v where v.profile_id = p.id),
         p.updated_at,
         case when q = '' then 0::real else similarity(p.candidate_name, q) end
  from public.profiles p
  left join public.app_users u on u.id = p.owner_id
  where not p.archived
    and (q = '' or p.candidate_name % q or p.candidate_name ilike pattern)
  order by 9 desc, p.updated_at desc
  limit 50;
end;
$$;

revoke all on function public.search_profiles_by_name(text) from public, anon;
grant execute on function public.search_profiles_by_name(text) to authenticated;
