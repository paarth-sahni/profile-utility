-- Purpose: TASK-02 follow-up to 20261010120000_search_profiles_by_name.sql. Short typos did not match
-- ("alx" found nothing), because similarity() compares the query with the WHOLE name. A profile now matches when
--   1. a word of the name starts with the query (prefix: "alex samp", "sam"), or
--   2. word_similarity(query, name) >= 0.35 (the query is compared with the best-matching words of the name:
--      "alx", "alex sampl", "jmie"), or
--   3. the query has 4+ letters, starts with the same letter as some word of the name, and word_similarity >= 0.2
--      (transpositions such as "aelx" share few trigrams, so they need the lower bar; the first-letter rule keeps
--      unrelated names out).
-- Unchanged: security invoker, manager/admin role check (42501), 50 rows max, empty query = most recent,
-- LIKE wildcards escaped, archived profiles skipped. Privileges are kept by CREATE OR REPLACE.
-- The functions (not the <% operators) are used so these thresholds are explicit; the table is small enough for
-- a scan, and the trigram GIN index stays available for a future operator-based version.

create or replace function public.search_profiles_by_name(p_query text)
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
  select p.id, p.template, p.candidate_name, p.owner_id, u.full_name, u.email,
         (select count(*)::int from public.profile_versions v where v.profile_id = p.id),
         p.updated_at,
         case when q = '' then 0::real
              when p.candidate_name ilike q_prefix or p.candidate_name ilike q_word then
                greatest(word_similarity(q, p.candidate_name), 0.9)::real
              else word_similarity(q, p.candidate_name)
         end
  from public.profiles p
  left join public.app_users u on u.id = p.owner_id
  where not p.archived
    and (
      q = ''
      or p.candidate_name ilike q_prefix
      or p.candidate_name ilike q_word
      or word_similarity(q, p.candidate_name) >= 0.35
      or (
        length(q) >= 4
        and word_similarity(q, p.candidate_name) >= 0.2
        and exists (
          select 1 from regexp_split_to_table(lower(p.candidate_name), '\s+') as w
          where left(w, 1) = left(lower(q), 1)
        )
      )
    )
  order by 9 desc, p.updated_at desc
  limit 50;
end;
$$;
