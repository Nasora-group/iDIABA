-- iDIABA Sprint 1: auth, multi-tenant workspace, memberships, and RLS
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin create type public.tenant_role as enum ('owner','admin','manager','cashier','stock','accountant','viewer'); exception when duplicate_object then null; end $$;\n\ncreate table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.tenant_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists tenant_memberships_user_idx on public.tenant_memberships(user_id);
create index if not exists tenant_memberships_tenant_idx on public.tenant_memberships(tenant_id);

create or replace function public.is_tenant_member(target_tenant uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.tenant_memberships m where m.tenant_id=target_tenant and m.user_id=auth.uid()); $$;

create or replace function public.has_tenant_role(target_tenant uuid, allowed_roles public.tenant_role[])
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.tenant_memberships m where m.tenant_id=target_tenant and m.user_id=auth.uid() and m.role=any(allowed_roles)); $$;

create or replace function public.create_tenant(workspace_name text, workspace_slug text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_tenant_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(workspace_name)) < 2 or length(trim(workspace_name)) > 120 then raise exception 'Workspace name must be 2-120 characters'; end if;
  if workspace_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(workspace_slug) > 60 then raise exception 'Invalid workspace slug'; end if;
  insert into public.tenants(name,slug,created_by) values(trim(workspace_name),workspace_slug,auth.uid()) returning id into new_tenant_id;
  insert into public.tenant_memberships(tenant_id,user_id,role) values(new_tenant_id,auth.uid(),'owner');
  return new_tenant_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare workspace_id uuid; workspace_slug text;
begin
  insert into public.profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name','')) on conflict (id) do nothing;
  -- Create the workspace at signup, including when email confirmation is enabled.
  if length(trim(coalesce(new.raw_user_meta_data->>'workspace_name',''))) between 2 and 120 then
    workspace_slug := lower(regexp_replace(trim(coalesce(new.raw_user_meta_data->>'workspace_slug','')), '[^a-z0-9]+', '-', 'g'));
    workspace_slug := trim(both '-' from workspace_slug);
    if workspace_slug = '' then workspace_slug := 'workspace-' || substr(new.id::text,1,8); end if;
    if exists(select 1 from public.tenants where slug=workspace_slug) then workspace_slug := workspace_slug || '-' || substr(new.id::text,1,8); end if;
    insert into public.tenants(name,slug,created_by) values(trim(new.raw_user_meta_data->>'workspace_name'),workspace_slug,new.id) returning id into workspace_id;
    insert into public.tenant_memberships(tenant_id,user_id,role) values(workspace_id,new.id,'owner');
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;

create policy "profiles read self" on public.profiles for select to authenticated using (id=auth.uid());
create policy "profiles update self" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy "tenant members can read tenant" on public.tenants for select to authenticated using (public.is_tenant_member(id));
create policy "tenant admins can update tenant" on public.tenants for update to authenticated using (public.has_tenant_role(id,array['owner','admin']::public.tenant_role[])) with check (public.has_tenant_role(id,array['owner','admin']::public.tenant_role[]));
create policy "members can read memberships in their tenant" on public.tenant_memberships for select to authenticated using (public.is_tenant_member(tenant_id));

grant select, update on public.profiles to authenticated;
grant select, update on public.tenants to authenticated;
grant select on public.tenant_memberships to authenticated;
grant execute on function public.create_tenant(text,text) to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.has_tenant_role(uuid,public.tenant_role[]) to authenticated;
