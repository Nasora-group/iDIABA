-- Defense in depth: anonymous clients must not hold direct table or sequence grants.
-- Public tables already have RLS enabled; this removes the extra SQL privilege layer.
-- The default ACL changes apply to the current migration owner (postgres).
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
alter default privileges in schema public
  revoke all privileges on tables from anon;
alter default privileges in schema public
  revoke all privileges on sequences from anon;

-- The tenant-peer profile policy already includes the current user's own profile.
-- Remove the narrower duplicate without changing the visible profile set.
drop policy if exists "profiles read self" on public.profiles;

-- Merge equivalent SELECT access paths into one policy per table. The OR expressions
-- preserve the union of the two existing policies exactly.
drop policy if exists "platform admins read all subscription payments" on public.subscription_payments;
drop policy if exists "tenant owners read subscription payments" on public.subscription_payments;
create policy "platform admins and tenant owners read subscription payments"
  on public.subscription_payments for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata' ->> 'role') = 'platform_admin')
    or has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[])
  );

drop policy if exists "platform admins read all subscription requests" on public.subscription_requests;
drop policy if exists "tenant owners read subscription requests" on public.subscription_requests;
create policy "platform admins and tenant owners read subscription requests"
  on public.subscription_requests for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata' ->> 'role') = 'platform_admin')
    or has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[])
  );

drop policy if exists "platform admins read all tenant subscriptions" on public.tenant_subscriptions;
drop policy if exists "tenant owners read subscriptions" on public.tenant_subscriptions;
create policy "platform admins and tenant owners read subscriptions"
  on public.tenant_subscriptions for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata' ->> 'role') = 'platform_admin')
    or has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[])
  );

drop policy if exists "platform admins read tenant names" on public.tenants;
drop policy if exists "tenant members can read tenant" on public.tenants;
create policy "platform admins and tenant members read tenant"
  on public.tenants for select to authenticated
  using (
    ((auth.jwt() -> 'app_metadata' ->> 'role') = 'platform_admin')
    or is_tenant_member(id)
  );
