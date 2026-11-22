-- Cache the JWT claim lookup once per statement instead of re-evaluating it for each row.
-- This preserves the exact authorization semantics of migration 0048.
drop policy if exists "platform admins and tenant owners read subscription payments" on public.subscription_payments;
create policy "platform admins and tenant owners read subscription payments"
  on public.subscription_payments for select to authenticated
  using (
    (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin')
    or has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[])
  );

drop policy if exists "platform admins and tenant owners read subscription requests" on public.subscription_requests;
create policy "platform admins and tenant owners read subscription requests"
  on public.subscription_requests for select to authenticated
  using (
    (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin')
    or has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[])
  );

drop policy if exists "platform admins and tenant owners read subscriptions" on public.tenant_subscriptions;
create policy "platform admins and tenant owners read subscriptions"
  on public.tenant_subscriptions for select to authenticated
  using (
    (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin')
    or has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[])
  );

drop policy if exists "platform admins and tenant members read tenant" on public.tenants;
create policy "platform admins and tenant members read tenant"
  on public.tenants for select to authenticated
  using (
    (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin')
    or is_tenant_member(id)
  );
