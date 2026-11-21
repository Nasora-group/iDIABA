-- iDIABA Sprint 3: warehouses and immutable stock ledger.
-- Quantities are stored as exact decimals; stock is derived from movements.
create table if not exists public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 100),
  code text not null check (length(trim(code)) between 2 and 32),
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

create unique index if not exists products_tenant_id_id_uidx
  on public.products(tenant_id, id);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  product_id uuid not null,
  movement_type text not null check (movement_type in ('opening','adjustment','receipt','sale','sale_return','purchase_return','transfer_in','transfer_out')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  reference text not null default '',
  note text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint stock_movement_location_tenant_fk
    foreign key (tenant_id, location_id)
    references public.stock_locations(tenant_id, id),
  constraint stock_movement_product_tenant_fk
    foreign key (tenant_id, product_id)
    references public.products(tenant_id, id)
);

create index if not exists stock_movements_tenant_location_product_idx
  on public.stock_movements(tenant_id, location_id, product_id, created_at desc);
create index if not exists stock_movements_tenant_created_idx
  on public.stock_movements(tenant_id, created_at desc);

alter table public.stock_locations enable row level security;
alter table public.stock_movements enable row level security;

create policy "members read stock locations"
  on public.stock_locations for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "stock managers create locations"
  on public.stock_locations for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]));
create policy "stock managers update locations"
  on public.stock_locations for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]));

create policy "members read stock movements"
  on public.stock_movements for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "stock managers record movements"
  on public.stock_movements for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]));

create or replace function public.guard_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare current_quantity numeric(14,3);
begin
  if not public.has_tenant_role(new.tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]) then
    raise exception 'Insufficient permissions to record stock movements';
  end if;

  if not exists (
    select 1 from public.products p
    where p.id = new.product_id and p.tenant_id = new.tenant_id and p.is_active = true
  ) then
    raise exception 'Product is unavailable or belongs to another company';
  end if;

  if not exists (
    select 1 from public.stock_locations l
    where l.id = new.location_id and l.tenant_id = new.tenant_id and l.is_active = true
  ) then
    raise exception 'Stock location is unavailable or belongs to another company';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.location_id::text || ':' || new.product_id::text, 0));
  select coalesce(sum(sm.quantity_delta), 0)
    into current_quantity
    from public.stock_movements sm
    where sm.tenant_id = new.tenant_id
      and sm.location_id = new.location_id
      and sm.product_id = new.product_id;

  if current_quantity + new.quantity_delta < 0 then
    raise exception 'Insufficient stock. Available: %', current_quantity;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_movement_guard_before_insert on public.stock_movements;
create trigger stock_movement_guard_before_insert
  before insert on public.stock_movements
  for each row execute function public.guard_stock_movement();

create or replace function public.prevent_stock_movement_mutation()
returns trigger language plpgsql
as $$
begin
  raise exception 'Stock movements are immutable. Record a correcting movement instead.';
end;
$$;

drop trigger if exists stock_movements_immutable on public.stock_movements;
create trigger stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.prevent_stock_movement_mutation();

grant select, insert, update on public.stock_locations to authenticated;
grant select, insert on public.stock_movements to authenticated;
