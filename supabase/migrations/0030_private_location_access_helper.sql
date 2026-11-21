-- Keep the SECURITY DEFINER implementation outside the exposed public API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.has_stock_location_access(
  target_tenant uuid,
  target_location uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when auth.uid() is null then false
    when target_tenant is null or target_location is null then false
    when public.has_tenant_role(target_tenant,array['owner','admin','manager']::public.tenant_role[]) then true
    when not public.is_tenant_member(target_tenant) then false
    -- Backward compatibility: a location remains tenant-wide until an admin assigns staff.
    when not exists (
      select 1 from public.stock_location_memberships m
      where m.tenant_id=target_tenant and m.location_id=target_location
    ) then true
    else exists (
      select 1 from public.stock_location_memberships m
      where m.tenant_id=target_tenant and m.location_id=target_location and m.user_id=auth.uid()
    )
  end;
$$;

revoke all on function private.has_stock_location_access(uuid,uuid) from public,anon,authenticated;
grant execute on function private.has_stock_location_access(uuid,uuid) to authenticated;

-- Keep the existing public function signature used by RLS policies, but make it
-- a SECURITY INVOKER wrapper. The elevated implementation is only in private.
create or replace function public.has_stock_location_access(
  target_tenant uuid,
  target_location uuid
)
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.has_stock_location_access(target_tenant,target_location);
$$;

revoke all on function public.has_stock_location_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.has_stock_location_access(uuid,uuid) to authenticated;
