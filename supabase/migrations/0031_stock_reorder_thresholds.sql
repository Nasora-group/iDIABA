create table if not exists public.stock_reorder_thresholds (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  product_id uuid not null,
  minimum_quantity numeric(14,3) not null check (minimum_quantity > 0 and minimum_quantity <= 1000000000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, location_id, product_id),
  constraint stock_reorder_thresholds_location_fk
    foreign key (tenant_id, location_id)
    references public.stock_locations(tenant_id, id) on delete cascade,
  constraint stock_reorder_thresholds_product_fk
    foreign key (tenant_id, product_id)
    references public.products(tenant_id, id) on delete cascade
);

create index if not exists stock_reorder_thresholds_product_idx
  on public.stock_reorder_thresholds(tenant_id, product_id, location_id);

alter table public.stock_reorder_thresholds enable row level security;

create policy "members read location reorder thresholds"
  on public.stock_reorder_thresholds for select to authenticated
  using (public.is_tenant_member(tenant_id) and private.has_stock_location_access(tenant_id, location_id));

create policy "stock managers set reorder thresholds"
  on public.stock_reorder_thresholds for insert to authenticated
  with check (
    public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[])
    and private.has_stock_location_access(tenant_id, location_id)
  );

create policy "stock managers update reorder thresholds"
  on public.stock_reorder_thresholds for update to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[])
    and private.has_stock_location_access(tenant_id, location_id)
  )
  with check (
    public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[])
    and private.has_stock_location_access(tenant_id, location_id)
  );

create policy "stock managers delete reorder thresholds"
  on public.stock_reorder_thresholds for delete to authenticated
  using (
    public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[])
    and private.has_stock_location_access(tenant_id, location_id)
  );

grant select, insert, update, delete on public.stock_reorder_thresholds to authenticated;
