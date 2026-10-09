-- Purpose: TASK-02 step 3. Per-role Row Level Security policies and least-privilege table grants.
-- RLS was already ENABLED on every table in the init migration (default deny). This migration adds the
-- explicit permissions; a table or operation without a policy stays unreachable.
--
-- Roles: team_member, checker, manager, admin (public.app_role). anon gets nothing anywhere.
-- app_settings deliberately has NO policy and NO grant: only security-definer code reads it.
-- All schema changes go through migrations; never edit policies from the dashboard.

------------------------------------------------------------------------------------------------
-- 1. Grants: authenticated gets only what the policies below can use (defence in depth).
--    Column-level UPDATE keeps ownership, template, ids and everything else frozen.
------------------------------------------------------------------------------------------------
revoke all on all tables    in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;
alter default privileges in schema public revoke all on tables    from authenticated;
alter default privileges in schema public revoke all on sequences from authenticated;

grant select on
  public.app_users, public.profiles, public.profile_versions,
  public.version_education, public.version_projects, public.project_technologies,
  public.project_responsibilities, public.version_skills, public.version_list_items,
  public.version_experience, public.experience_highlights, public.version_review_flags,
  public.checker_reviews, public.review_items, public.audit_log
to authenticated;

grant insert on
  public.profiles, public.profile_versions,
  public.version_education, public.version_projects, public.project_technologies,
  public.project_responsibilities, public.version_skills, public.version_list_items,
  public.version_experience, public.experience_highlights, public.version_review_flags,
  public.checker_reviews, public.review_items, public.audit_log
to authenticated;

-- No UPDATE grant at all on versions, child tables or audit_log (they are immutable / insert-only).
grant update (candidate_name, current_version_id, archived, updated_at) on public.profiles to authenticated;
grant update (role)                 on public.app_users       to authenticated;
grant update (status, comment)      on public.checker_reviews to authenticated;
grant update (path, reason, resolved) on public.review_items  to authenticated;

-- DELETE is for admin only (the policies enforce it); children go away by cascade.
grant delete on public.profiles, public.profile_versions, public.checker_reviews, public.review_items to authenticated;

------------------------------------------------------------------------------------------------
-- 2. Guards that policies cannot express
------------------------------------------------------------------------------------------------
-- app_users: an API caller may change `role` only, only as admin, and never their own.
-- auth.uid() is null for the service role / postgres (seed and admin tooling), which is not restricted here.
create function public.guard_app_user_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if (to_jsonb(new) - 'role') is distinct from (to_jsonb(old) - 'role') then
    raise exception 'Only the role of a user can be changed' using errcode = '42501';
  end if;
  if new.role is distinct from old.role
     and (old.id = auth.uid() or public.current_app_role() is distinct from 'admin') then
    raise exception 'Only an admin can change a role, and not their own' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger app_users_guard before update on public.app_users
  for each row execute function public.guard_app_user_update();

-- profiles: current_version_id must point at one of the profile's own versions.
create function public.guard_profile_current_version() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.current_version_id is not null
     and new.current_version_id is distinct from old.current_version_id
     and not exists (select 1 from public.profile_versions v
                     where v.id = new.current_version_id and v.profile_id = new.id) then
    raise exception 'current_version_id must belong to this profile' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger profiles_current_version_guard before update on public.profiles
  for each row execute function public.guard_profile_current_version();

-- Trigger functions are never called directly: no EXECUTE for anon, authenticated or PUBLIC.
revoke all on function public.guard_app_user_update(), public.guard_profile_current_version() from public, anon, authenticated;

------------------------------------------------------------------------------------------------
-- 3. app_users
------------------------------------------------------------------------------------------------
create policy app_users_select on public.app_users for select to authenticated
  using (id = (select auth.uid()) or (select public.current_app_role()) in ('manager', 'admin'));

-- Admin may update any row; the trigger above narrows that to the role column, never their own.
create policy app_users_admin_update on public.app_users for update to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

------------------------------------------------------------------------------------------------
-- 4. profiles
------------------------------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (owner_id = (select auth.uid()) or (select public.current_app_role()) in ('checker', 'manager', 'admin'));

create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.current_app_role()) = 'team_member');

create policy profiles_update_own on public.profiles for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.current_app_role()) = 'team_member')
  with check (owner_id = (select auth.uid()));

create policy profiles_admin_all on public.profiles for all to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

------------------------------------------------------------------------------------------------
-- 5. profile_versions (immutable: no UPDATE policy and no UPDATE grant)
------------------------------------------------------------------------------------------------
create policy profile_versions_select on public.profile_versions for select to authenticated
  using (
    (select public.current_app_role()) in ('checker', 'manager', 'admin')
    or exists (select 1 from public.profiles p
               where p.id = profile_versions.profile_id and p.owner_id = (select auth.uid()))
  );

-- Members (and an admin, on their own profiles) save versions on profiles they own.
create policy profile_versions_insert_own on public.profile_versions for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select public.current_app_role()) in ('team_member', 'admin')
    and exists (select 1 from public.profiles p
                where p.id = profile_versions.profile_id and p.owner_id = (select auth.uid()))
  );

create policy profile_versions_admin_delete on public.profile_versions for delete to authenticated
  using ((select public.current_app_role()) = 'admin');

------------------------------------------------------------------------------------------------
-- 6. Child tables. Each has its own SELECT and INSERT policy that joins back to
--    profile_versions -> profiles.owner_id. No UPDATE (immutable) and no DELETE (cascade only).
--    INSERT additionally requires created_at = now(): rows may only be added in the SAME transaction
--    that created the version, so a saved version can never grow new rows later.
------------------------------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      -- table,                      from/where chain that reaches the version row `v` and its profile `p`
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
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         (select public.current_app_role()) in (''checker'', ''manager'', ''admin'')
         or exists (select 1 from %s and p.owner_id = (select auth.uid())))',
      c.tbl || '_select', c.tbl, c.chain);

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
         (select public.current_app_role()) in (''team_member'', ''admin'')
         and exists (select 1 from %s
                     and p.owner_id = (select auth.uid()) and v.created_by = (select auth.uid())
                     and v.created_at = now()))',
      c.tbl || '_insert', c.tbl, c.chain);
  end loop;
end $$;

------------------------------------------------------------------------------------------------
-- 7. checker_reviews and review_items (screens come in TASK-04)
--    team_member: read on own profiles. checker: create, read and update their own. manager: read all.
--    admin: all.
------------------------------------------------------------------------------------------------
create policy checker_reviews_select on public.checker_reviews for select to authenticated
  using (
    (select public.current_app_role()) in ('manager', 'admin')
    or (checker_id = (select auth.uid()) and (select public.current_app_role()) = 'checker')
    or ((select public.current_app_role()) = 'team_member' and exists (
          select 1 from public.profile_versions v join public.profiles p on p.id = v.profile_id
          where v.id = checker_reviews.version_id and p.owner_id = (select auth.uid())))
  );

create policy checker_reviews_insert on public.checker_reviews for insert to authenticated
  with check (checker_id = (select auth.uid()) and (select public.current_app_role()) = 'checker');

create policy checker_reviews_update_own on public.checker_reviews for update to authenticated
  using (checker_id = (select auth.uid()) and (select public.current_app_role()) = 'checker')
  with check (checker_id = (select auth.uid()));

create policy checker_reviews_admin_all on public.checker_reviews for all to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

create policy review_items_select on public.review_items for select to authenticated
  using (
    (select public.current_app_role()) in ('manager', 'admin')
    or ((select public.current_app_role()) = 'checker' and exists (
          select 1 from public.checker_reviews r
          where r.id = review_items.review_id and r.checker_id = (select auth.uid())))
    or ((select public.current_app_role()) = 'team_member' and exists (
          select 1 from public.checker_reviews r
          join public.profile_versions v on v.id = r.version_id
          join public.profiles p on p.id = v.profile_id
          where r.id = review_items.review_id and p.owner_id = (select auth.uid())))
  );

create policy review_items_insert on public.review_items for insert to authenticated
  with check (
    (select public.current_app_role()) = 'checker' and exists (
      select 1 from public.checker_reviews r
      where r.id = review_items.review_id and r.checker_id = (select auth.uid()))
  );

create policy review_items_update_own on public.review_items for update to authenticated
  using ((select public.current_app_role()) = 'checker' and exists (
           select 1 from public.checker_reviews r
           where r.id = review_items.review_id and r.checker_id = (select auth.uid())))
  with check (exists (
           select 1 from public.checker_reviews r
           where r.id = review_items.review_id and r.checker_id = (select auth.uid())));

create policy review_items_admin_all on public.review_items for all to authenticated
  using ((select public.current_app_role()) = 'admin')
  with check ((select public.current_app_role()) = 'admin');

------------------------------------------------------------------------------------------------
-- 8. audit_log: manager and admin read; every signed-in user may append a row naming themselves
--    (save_profile_version does this as the caller). No UPDATE or DELETE exists for anyone.
------------------------------------------------------------------------------------------------
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.current_app_role()) in ('manager', 'admin'));

create policy audit_log_insert_self on public.audit_log for insert to authenticated
  with check (actor_id = (select auth.uid()));
