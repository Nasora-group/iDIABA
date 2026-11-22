-- Universal commerce profile: additive, tenant-scoped configuration.
-- Existing tenants and business data remain untouched.
create table if not exists public.tenant_business_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  business_type text not null default 'general'
    check (business_type in (
      'general','grocery','hardware','fashion','pharmacy','restaurant',
      'auto_parts','electronics','beauty','wholesale','services','other'
    )),
  enabled_modules text[] not null default array[
    'catalog','sales','stock','purchases','customers','cash','reports'
  ]::text[],
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_business_profiles_business_type_idx
  on public.tenant_business_profiles(business_type);

alter table public.tenant_business_profiles enable row level security;

drop policy if exists "tenant members read business profile" on public.tenant_business_profiles;
create policy "tenant members read business profile"
  on public.tenant_business_profiles for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists "tenant admins insert business profile" on public.tenant_business_profiles;
create policy "tenant admins insert business profile"
  on public.tenant_business_profiles for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]));

drop policy if exists "tenant admins update business profile" on public.tenant_business_profiles;
create policy "tenant admins update business profile"
  on public.tenant_business_profiles for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin']::public.tenant_role[]));

grant select, insert, update on public.tenant_business_profiles to authenticated;
