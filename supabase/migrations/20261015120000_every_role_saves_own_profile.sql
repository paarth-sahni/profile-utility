-- Purpose: every signed-in role (team_member, checker, manager, admin) may create, save, submit and set primary on
-- profiles they OWN. Until now only team_member (and admin) could write their own profile.
--
-- Changed: the role condition is dropped from the owner-only write policies; the ownership conditions stay exactly as
-- they were:
--   * profiles_insert_own, profiles_update_own (owner_id = the caller)
--   * profile_versions_insert_own and the nine child-table *_insert policies (the version's profile is the caller's,
--     the caller created the version, in this same transaction)
-- Not changed: every read policy (checker / manager / admin still read everyone's rows), profiles_admin_all, the
-- review policies, column grants, triggers and functions. save_profile_version, submit_profile_version and
-- set_primary_profile have no role checks of their own: they rely on these policies and on the owner check, so they
-- now work for every role on the caller's own profiles. Nobody gains any write on someone else's profile.

-- profiles ---------------------------------------------------------------------------------------------------------
drop policy profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- profile_versions ---------------------------------------------------------------------------------------------------
drop policy profile_versions_insert_own on public.profile_versions;
create policy profile_versions_insert_own on public.profile_versions for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (select 1 from public.profiles p
                where p.id = profile_versions.profile_id and p.owner_id = (select auth.uid()))
  );

-- child tables: rows only on a version the caller just created on their own profile ----------------------------------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('version_education',         'public.profile_versions v join public.profiles p on p.id = v.profile_id where v.id = version_education.version_id'),
      ('version_projects',          'public.profile_versions v join public.profiles p on p.id = v.profile_id where v.id = version_projects.version_id'),
      ('version_skills',            'public.profile_versions v join public.profiles p on p.id = v.profile_id where v.id = version_skills.version_id'),
      ('version_list_items',        'public.profile_versions v join public.profiles p on p.id = v.profile_id where v.id = version_list_items.version_id'),
      ('version_experience',        'public.profile_versions v join public.profiles p on p.id = v.profile_id where v.id = version_experience.version_id'),
      ('version_review_flags',      'public.profile_versions v join public.profiles p on p.id = v.profile_id where v.id = version_review_flags.version_id'),
      ('project_technologies',      'public.version_projects x join public.profile_versions v on v.id = x.version_id join public.profiles p on p.id = v.profile_id where x.id = project_technologies.project_id'),
      ('project_responsibilities',  'public.version_projects x join public.profile_versions v on v.id = x.version_id join public.profiles p on p.id = v.profile_id where x.id = project_responsibilities.project_id'),
      ('experience_highlights',     'public.version_experience x join public.profile_versions v on v.id = x.version_id join public.profiles p on p.id = v.profile_id where x.id = experience_highlights.experience_id')
    ) as t(tbl, chain)
  loop
    execute format('drop policy %I on public.%I', c.tbl || '_insert', c.tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
         exists (select 1 from %s
                 and p.owner_id = (select auth.uid()) and v.created_by = (select auth.uid())
                 and v.created_at = now()))',
      c.tbl || '_insert', c.tbl, c.chain);
  end loop;
end $$;
