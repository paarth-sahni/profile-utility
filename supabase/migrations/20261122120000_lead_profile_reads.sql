-- Purpose: read-only functions that let the server show a PRIMARY profile to a "lead": an employee with reportees in the Teams
-- data (read live by ops/teams_db.py; never stored), whose app role may be team_member, so Row Level Security alone would show
-- them only their own profiles. The database cannot know who is a lead, so the Next.js server decides (lib/teamAccess.ts) and
-- only then calls these through the service-role client (lib/sync/adminClient.ts, rpc only).
--
--   team_primary_profile(email)          the current version of that person's primary profile (get_profile_version's shape),
--                                        plus profileId / versionId; null when there is none
--   team_primary_profile_emails(emails)  which of these emails (lower case) own a primary profile (the team list's yes / no)
--   team_version_owner_email(version)    the owner's email of a saved version (the PDF file name: the owner's IB code)
--
-- EXECUTE for service_role only (signed-in users, anon and PUBLIC are revoked); read-only (stable); no table grant changes.
-- ADDITIVE ONLY: new functions; alters nothing that exists. Re-runnable.

begin;

create or replace function public.team_primary_profile(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_profile public.profiles;
  v_version jsonb;
begin
  if p_email is null or length(p_email) > 254 then return null; end if;
  select p.* into v_profile
  from public.profiles p join public.app_users u on u.id = p.owner_id
  where lower(u.email) = lower(btrim(p_email)) and p.is_primary and p.current_version_id is not null
  limit 1;
  if not found then return null; end if;
  -- get_profile_version is security invoker: here it runs as this function's owner, so it sees the version
  v_version := public.get_profile_version(v_profile.current_version_id);
  if v_version is null then return null; end if;
  return v_version || jsonb_build_object('profileId', v_profile.id, 'versionId', v_profile.current_version_id);
end
$$;

create or replace function public.team_primary_profile_emails(p_emails text[]) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct lower(u.email)), '{}')
  from public.profiles p join public.app_users u on u.id = p.owner_id
  where p.is_primary and p.current_version_id is not null
    and cardinality(p_emails) <= 5000
    and lower(u.email) = any (select lower(btrim(e)) from unnest(p_emails) e)
$$;

create or replace function public.team_version_owner_email(p_version_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(u.email)
  from public.profile_versions v join public.profiles p on p.id = v.profile_id join public.app_users u on u.id = p.owner_id
  where v.id = p_version_id
$$;

revoke all on function public.team_primary_profile(text) from public, anon, authenticated;
revoke all on function public.team_primary_profile_emails(text[]) from public, anon, authenticated;
revoke all on function public.team_version_owner_email(uuid) from public, anon, authenticated;
grant execute on function public.team_primary_profile(text) to service_role;
grant execute on function public.team_primary_profile_emails(text[]) to service_role;
grant execute on function public.team_version_owner_email(uuid) to service_role;

commit;
