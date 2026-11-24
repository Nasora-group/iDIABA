drop policy if exists "location managers read assignments" on public.stock_location_memberships;
create policy "location managers read assignments" on public.stock_location_memberships
for select to authenticated
using (
  user_id = (select auth.uid())
  or private.has_tenant_permission(tenant_id,'stock_manage')
);
