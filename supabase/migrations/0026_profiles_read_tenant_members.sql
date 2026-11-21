-- Allow an authenticated company member to read only the names of profiles
-- belonging to users who share one of their tenant memberships.
-- The existing self-read policy remains unchanged.
create policy "profiles read tenant peers"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.tenant_memberships target_member
    where target_member.user_id = profiles.id
      and public.is_tenant_member(target_member.tenant_id)
  )
);
