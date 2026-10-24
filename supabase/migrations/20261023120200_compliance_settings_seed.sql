-- Purpose: the single default settings row (file 3 of 3). Schedule: the 5th and 20th; 4 attempts; stale after 20 days.
-- Change later with a plain UPDATE on public.compliance_settings (no code change). Re-runnable: does nothing if the row exists.
-- Touches only the new compliance_settings table.

begin;

insert into public.compliance_settings (id) values (true) on conflict (id) do nothing;

commit;
