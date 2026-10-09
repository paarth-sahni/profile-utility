-- Purpose: TASK-02 follow-up to the RLS migration. A checker may READ every checker_review and review_item
-- (to see what other checkers flagged), but still creates and updates only their own (those policies are
-- unchanged: checker_reviews_insert / _update_own and review_items_insert / _update_own).
-- Other roles are unchanged: team_member reads reviews on their own profiles, manager and admin read all.

drop policy checker_reviews_select on public.checker_reviews;
create policy checker_reviews_select on public.checker_reviews for select to authenticated
  using (
    (select public.current_app_role()) in ('checker', 'manager', 'admin')
    or ((select public.current_app_role()) = 'team_member' and exists (
          select 1 from public.profile_versions v join public.profiles p on p.id = v.profile_id
          where v.id = checker_reviews.version_id and p.owner_id = (select auth.uid())))
  );

drop policy review_items_select on public.review_items;
create policy review_items_select on public.review_items for select to authenticated
  using (
    (select public.current_app_role()) in ('checker', 'manager', 'admin')
    or ((select public.current_app_role()) = 'team_member' and exists (
          select 1 from public.checker_reviews r
          join public.profile_versions v on v.id = r.version_id
          join public.profiles p on p.id = v.profile_id
          where r.id = review_items.review_id and p.owner_id = (select auth.uid())))
  );
