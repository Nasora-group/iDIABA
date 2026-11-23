-- 0051: tenant-specific custom role profiles (additive)
create table if not exists public.tenant_role_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 60),
  allowed_roles public.tenant_role[] not null default array['cashier']::public.tenant_role[],
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  check (cardinality(allowed_roles) > 0),
  check (not ('owner' = any(allowed_roles))),
  check (not ('admin' = any(allowed_roles)))
);
alter table public.tenant_memberships
  add column if not exists custom_role_profile_id uuid
  references public.tenant_role_profiles(id) on delete set null;
create index if not exists tenant_role_profiles_tenant_idx on public.tenant_role_profiles(tenant_id);
create index if not exists tenant_memberships_custom_profile_idx on public.tenant_memberships(custom_role_profile_id);

alter table public.tenant_role_profiles enable row level security;
drop policy if exists tenant_role_profiles_read on public.tenant_role_profiles;
create policy tenant_role_profiles_read on public.tenant_role_profiles
for select to authenticated using (public.is_tenant_member(tenant_id));
drop policy if exists tenant_role_profiles_admin_write on public.tenant_role_profiles;
create policy tenant_role_profiles_admin_write on public.tenant_role_profiles
for all to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]))
with check (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]));

create or replace function public.has_tenant_role(target_tenant uuid, allowed_roles public.tenant_role[])
returns boolean language sql stable security definer set search_path to 'pg_catalog','public'
as $function$
  select exists(
    select 1 from public.tenant_memberships m
    where m.tenant_id=target_tenant and m.user_id=auth.uid()
      and (
        m.role=any(allowed_roles)
        or exists (
          select 1 from public.tenant_role_profiles p
          where p.id=m.custom_role_profile_id and p.tenant_id=m.tenant_id
            and p.allowed_roles && allowed_roles
        )
      )
  );
$function$;

create or replace function public.set_tenant_member_custom_role_profile(
  p_tenant_id uuid, p_user_id uuid, p_profile_id uuid
) returns void language plpgsql security definer set search_path to 'pg_catalog','public'
as $function$
declare v_role public.tenant_role;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_tenant_role(p_tenant_id,array['owner','admin']::public.tenant_role[]) then
    raise exception 'Only company administrators can assign custom profiles';
  end if;
  select role into v_role from public.tenant_memberships
    where tenant_id=p_tenant_id and user_id=p_user_id for update;
  if not found then raise exception 'Membership not found'; end if;
  if v_role in ('owner','admin') and p_profile_id is not null then
    raise exception 'Administrator roles cannot use custom profiles';
  end if;
  if p_profile_id is not null and not exists (
    select 1 from public.tenant_role_profiles where id=p_profile_id and tenant_id=p_tenant_id
  ) then raise exception 'Profile does not belong to this company'; end if;
  update public.tenant_memberships set custom_role_profile_id=p_profile_id
    where tenant_id=p_tenant_id and user_id=p_user_id;
end;
$function$;
revoke all on function public.set_tenant_member_custom_role_profile(uuid,uuid,uuid) from public, anon;
grant execute on function public.set_tenant_member_custom_role_profile(uuid,uuid,uuid) to authenticated;
