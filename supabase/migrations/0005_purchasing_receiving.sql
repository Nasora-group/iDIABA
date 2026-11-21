-- iDIABA Sprint 5: suppliers, purchase orders and immutable goods receipts.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index if not exists suppliers_tenant_name_uidx
  on public.suppliers(tenant_id, lower(trim(name)));
create index if not exists suppliers_tenant_active_name_idx
  on public.suppliers(tenant_id, is_active, name);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_id uuid not null,
  location_id uuid not null,
  order_number text not null,
  status text not null default 'ordered'
    check (status in ('ordered','partially_received','received','cancelled')),
  notes text not null default '',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  created_by uuid references auth.users(id) on delete set null,
  ordered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, order_number),
  constraint purchase_order_supplier_tenant_fk foreign key (tenant_id, supplier_id)
    references public.suppliers(tenant_id, id),
  constraint purchase_order_location_tenant_fk foreign key (tenant_id, location_id)
    references public.stock_locations(tenant_id, id)
);
create index if not exists purchase_orders_tenant_status_date_idx
  on public.purchase_orders(tenant_id, status, ordered_at desc);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  purchase_order_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  received_quantity numeric(14,3) not null default 0
    check (received_quantity >= 0 and received_quantity <= quantity),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint purchase_order_items_order_tenant_fk foreign key (tenant_id, purchase_order_id)
    references public.purchase_orders(tenant_id, id),
  constraint purchase_order_items_product_tenant_fk foreign key (tenant_id, product_id)
    references public.products(tenant_id, id)
);
create index if not exists purchase_order_items_order_idx
  on public.purchase_order_items(tenant_id, purchase_order_id);

create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  purchase_order_id uuid not null,
  location_id uuid not null,
  receipt_number text not null,
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz not null default now(),
  notes text not null default '',
  unique (tenant_id, id),
  unique (tenant_id, receipt_number),
  constraint purchase_receipts_order_tenant_fk foreign key (tenant_id, purchase_order_id)
    references public.purchase_orders(tenant_id, id),
  constraint purchase_receipts_location_tenant_fk foreign key (tenant_id, location_id)
    references public.stock_locations(tenant_id, id)
);
create index if not exists purchase_receipts_order_date_idx
  on public.purchase_receipts(tenant_id, purchase_order_id, received_at desc);

create table if not exists public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receipt_id uuid not null,
  purchase_order_item_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  constraint purchase_receipt_items_receipt_tenant_fk foreign key (tenant_id, receipt_id)
    references public.purchase_receipts(tenant_id, id),
  constraint purchase_receipt_items_order_item_tenant_fk foreign key (tenant_id, purchase_order_item_id)
    references public.purchase_order_items(tenant_id, id),
  constraint purchase_receipt_items_product_tenant_fk foreign key (tenant_id, product_id)
    references public.products(tenant_id, id)
);
create index if not exists purchase_receipt_items_receipt_idx
  on public.purchase_receipt_items(tenant_id, receipt_id);

alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_receipt_items enable row level security;

create policy "members read suppliers" on public.suppliers for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "purchasing roles create suppliers" on public.suppliers for insert to authenticated
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]));
create policy "purchasing roles update suppliers" on public.suppliers for update to authenticated
  using (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]));

create policy "members read purchase orders" on public.purchase_orders for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "members read purchase order items" on public.purchase_order_items for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "members read purchase receipts" on public.purchase_receipts for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "members read purchase receipt items" on public.purchase_receipt_items for select to authenticated
  using (public.is_tenant_member(tenant_id));

grant select, insert, update on public.suppliers to authenticated;
grant select on public.purchase_orders, public.purchase_order_items,
  public.purchase_receipts, public.purchase_receipt_items to authenticated;

-- Orders are created atomically through this RPC; the browser cannot write order rows directly.
create or replace function public.create_purchase_order(
  p_tenant_id uuid,
  p_supplier_id uuid,
  p_location_id uuid,
  p_items jsonb,
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,3);
  v_unit_cost numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_tenant_role(p_tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]) then
    raise exception 'Insufficient permissions';
  end if;
  if not exists(select 1 from public.suppliers s where s.id=p_supplier_id and s.tenant_id=p_tenant_id and s.is_active) then
    raise exception 'Supplier unavailable';
  end if;
  if not exists(select 1 from public.stock_locations l where l.id=p_location_id and l.tenant_id=p_tenant_id and l.is_active) then
    raise exception 'Stock location unavailable';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Order must contain between 1 and 100 lines';
  end if;

  v_order_id := gen_random_uuid();
  v_order_number := 'PO-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 8));
  insert into public.purchase_orders(id, tenant_id, supplier_id, location_id, order_number, notes, created_by)
  values(v_order_id, p_tenant_id, p_supplier_id, p_location_id, v_order_number, left(coalesce(p_notes,''),1000), auth.uid());

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    if v_quantity is null or v_quantity <= 0 or v_quantity > 1000000000
      or v_unit_cost is null or v_unit_cost < 0 or v_unit_cost > 999999999999 then
      raise exception 'Invalid order quantity or unit cost';
    end if;
    if not exists(select 1 from public.products p where p.id=v_product_id and p.tenant_id=p_tenant_id and p.is_active) then
      raise exception 'Product unavailable';
    end if;
    insert into public.purchase_order_items(tenant_id,purchase_order_id,product_id,quantity,unit_cost,line_total)
    values(p_tenant_id,v_order_id,v_product_id,v_quantity,v_unit_cost,round(v_quantity*v_unit_cost,2));
    v_subtotal := v_subtotal + round(v_quantity*v_unit_cost,2);
  end loop;

  update public.purchase_orders set subtotal=v_subtotal,total_amount=v_subtotal,updated_at=now()
  where id=v_order_id and tenant_id=p_tenant_id;
  return v_order_id;
end;
$$;

-- A receipt and all corresponding stock entries are committed as one transaction.
create or replace function public.receive_purchase_order(
  p_purchase_order_id uuid,
  p_items jsonb,
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.purchase_orders%rowtype;
  v_item jsonb;
  v_line public.purchase_order_items%rowtype;
  v_quantity numeric(14,3);
  v_receipt_id uuid := gen_random_uuid();
  v_receipt_number text;
  v_count integer := 0;
  v_received_total numeric(14,3) := 0;
  v_remaining numeric(14,3);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_order from public.purchase_orders
    where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not public.has_tenant_role(v_order.tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]) then
    raise exception 'Insufficient permissions';
  end if;
  if v_order.status not in ('ordered','partially_received') then raise exception 'Order cannot be received'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Receipt must contain at least one line';
  end if;

  v_receipt_number := 'REC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_receipt_id::text, '-', ''), 1, 8));
  insert into public.purchase_receipts(id,tenant_id,purchase_order_id,location_id,receipt_number,received_by,notes)
  values(v_receipt_id,v_order.tenant_id,v_order.id,v_order.location_id,v_receipt_number,auth.uid(),left(coalesce(p_notes,''),1000));

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    select * into v_line from public.purchase_order_items
      where id=(v_item->>'order_item_id')::uuid
        and tenant_id=v_order.tenant_id and purchase_order_id=v_order.id
      for update;
    if not found then raise exception 'Order line not found'; end if;
    v_quantity := (v_item->>'quantity')::numeric;
    v_remaining := v_line.quantity - v_line.received_quantity;
    if v_quantity is null or v_quantity <= 0 or v_quantity > v_remaining then
      raise exception 'Received quantity exceeds remaining quantity';
    end if;

    insert into public.purchase_receipt_items(tenant_id,receipt_id,purchase_order_item_id,product_id,quantity,unit_cost)
    values(v_order.tenant_id,v_receipt_id,v_line.id,v_line.product_id,v_quantity,v_line.unit_cost);

    insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
    values(v_order.tenant_id,v_order.location_id,v_line.product_id,'receipt',v_quantity,v_order.order_number,
      'Réception ' || v_receipt_number,auth.uid());

    update public.purchase_order_items set received_quantity=received_quantity+v_quantity
      where id=v_line.id and tenant_id=v_order.tenant_id;
    v_received_total := v_received_total + v_quantity;
  end loop;

  if v_count = 0 or v_received_total <= 0 then raise exception 'Empty receipt'; end if;
  if exists(select 1 from public.purchase_order_items i
    where i.tenant_id=v_order.tenant_id and i.purchase_order_id=v_order.id
      and i.received_quantity < i.quantity) then
    update public.purchase_orders set status='partially_received',updated_at=now()
      where id=v_order.id and tenant_id=v_order.tenant_id;
  else
    update public.purchase_orders set status='received',updated_at=now()
      where id=v_order.id and tenant_id=v_order.tenant_id;
  end if;
  return v_receipt_id;
end;
$$;

-- Keep receipt history immutable; corrections must be handled by a future return workflow.
create or replace function public.prevent_purchase_receipt_mutation()
returns trigger language plpgsql
as $$
begin
  raise exception 'Purchase receipts are immutable.';
end;
$$;
drop trigger if exists purchase_receipts_immutable on public.purchase_receipts;
create trigger purchase_receipts_immutable before update or delete on public.purchase_receipts
  for each row execute function public.prevent_purchase_receipt_mutation();
drop trigger if exists purchase_receipt_items_immutable on public.purchase_receipt_items;
create trigger purchase_receipt_items_immutable before update or delete on public.purchase_receipt_items
  for each row execute function public.prevent_purchase_receipt_mutation();

revoke all on function public.create_purchase_order(uuid,uuid,uuid,jsonb,text) from public;
revoke all on function public.receive_purchase_order(uuid,jsonb,text) from public;
grant execute on function public.create_purchase_order(uuid,uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.receive_purchase_order(uuid,jsonb,text) to authenticated;
