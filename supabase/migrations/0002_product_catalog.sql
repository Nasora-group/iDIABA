-- iDIABA Sprint 2: tenant-scoped product catalog.
-- Prices are stored as exact decimal values (never floating point).
create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 80),
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid,
  name text not null check (length(trim(name)) between 2 and 160),
  sku text not null check (length(trim(sku)) between 2 and 64),
  barcode text,
  unit text not null default 'unité' check (length(trim(unit)) between 1 and 24),
  purchase_price numeric(14,2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_category_same_tenant_fk
    foreign key (tenant_id, category_id)
    references public.product_categories(tenant_id, id)
    on delete set null (category_id),
  unique (tenant_id, sku)
);

create unique index if not exists products_barcode_per_tenant_idx
  on public.products(tenant_id, barcode)
  where barcode is not null and barcode <> '';
create index if not exists products_tenant_active_name_idx
  on public.products(tenant_id, is_active, name);
create index if not exists products_tenant_category_idx
  on public.products(tenant_id, category_id);
create index if not exists product_categories_tenant_active_idx
  on public.product_categories(tenant_id, is_active, name);

alter table public.product_categories enable row level security;
alter table public.products enable row level security;

create policy "members read product categories"
  on public.product_categories for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "catalog managers create product categories"
  on public.product_categories for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]));
create policy "catalog managers update product categories"
  on public.product_categories for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]));

create policy "members read products"
  on public.products for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "catalog managers create products"
  on public.products for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]));
create policy "catalog managers update products"
  on public.products for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]));

grant select, insert, update on public.product_categories to authenticated;
grant select, insert, update on public.products to authenticated;
