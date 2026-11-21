-- iDIABA Sprint 28: inter-store / warehouse stock transfers with dispatch and receipt controls.
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_location_id uuid not null,
  destination_location_id uuid not null,
  transfer_number text not null,
  status text not null default 'draft'
    check (status in ('draft','shipped','partially_received','received','canceled')),
  notes text not null default '',
  client_transfer_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  shipped_by uuid references auth.users(id) on delete set null,
  received_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  shipped_at timestamptz,
  received_at timestamptz,
  unique (tenant_id,id),
  unique (tenant_id,transfer_number),
  unique (tenant_id,client_transfer_id),
  constraint stock_transfers_source_location_fk
    foreign key (tenant_id,source_location_id) references public.stock_locations(tenant_id,id),
  constraint stock_transfers_destination_location_fk
    foreign key (tenant_id,destination_location_id) references public.stock_locations(tenant_id,id),
  constraint stock_transfers_distinct_locations_check check (source_location_id <> destination_location_id)
);

create table if not exists public.stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  transfer_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0 and received_quantity <= quantity),
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,transfer_id,product_id),
  constraint stock_transfer_items_transfer_fk
    foreign key (tenant_id,transfer_id) references public.stock_transfers(tenant_id,id) on delete cascade,
  constraint stock_transfer_items_product_fk
    foreign key (tenant_id,product_id) references public.products(tenant_id,id)
);

create table if not exists public.stock_transfer_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  transfer_id uuid not null,
  receipt_number text not null,
  client_receipt_id uuid not null,
  received_by uuid not null references auth.users(id),
  notes text not null default '',
  received_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,receipt_number),
  unique (tenant_id,client_receipt_id),
  constraint stock_transfer_receipts_transfer_fk
    foreign key (tenant_id,transfer_id) references public.stock_transfers(tenant_id,id)
);

create table if not exists public.stock_transfer_receipt_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receipt_id uuid not null,
  transfer_item_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  constraint stock_transfer_receipt_items_receipt_fk
    foreign key (tenant_id,receipt_id) references public.stock_transfer_receipts(tenant_id,id) on delete cascade,
  constraint stock_transfer_receipt_items_transfer_item_fk
    foreign key (tenant_id,transfer_item_id) references public.stock_transfer_items(tenant_id,id),
  constraint stock_transfer_receipt_items_product_fk
    foreign key (tenant_id,product_id) references public.products(tenant_id,id)
);

create index if not exists stock_transfers_tenant_created_idx
  on public.stock_transfers(tenant_id,created_at desc);
create index if not exists stock_transfers_tenant_status_idx
  on public.stock_transfers(tenant_id,status,created_at desc);
create index if not exists stock_transfer_items_transfer_idx
  on public.stock_transfer_items(tenant_id,transfer_id);
create index if not exists stock_transfer_receipts_transfer_idx
  on public.stock_transfer_receipts(tenant_id,transfer_id,received_at desc);

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
alter table public.stock_transfer_receipts enable row level security;
alter table public.stock_transfer_receipt_items enable row level security;

create policy "tenant members read stock transfers" on public.stock_transfers
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "tenant members read stock transfer items" on public.stock_transfer_items
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "tenant members read stock transfer receipts" on public.stock_transfer_receipts
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "tenant members read stock transfer receipt items" on public.stock_transfer_receipt_items
  for select to authenticated using (public.is_tenant_member(tenant_id));

grant select on public.stock_transfers,public.stock_transfer_items,
  public.stock_transfer_receipts,public.stock_transfer_receipt_items to authenticated;

create or replace function public.create_stock_transfer(
  p_tenant_id uuid,
  p_source_location_id uuid,
  p_destination_location_id uuid,
  p_items jsonb,
  p_client_transfer_id uuid,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_transfer_id uuid := gen_random_uuid();
  v_transfer_number text;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,3);
  v_available numeric(14,3);
  v_count integer := 0;
begin
  if auth.uid() is null or not public.has_tenant_role(
    p_tenant_id,array['owner','admin','manager','stock']::public.tenant_role[]
  ) then
    raise exception 'Permission denied to create a stock transfer';
  end if;
  if p_client_transfer_id is null then raise exception 'Transfer idempotency key is required'; end if;
  select id into v_transfer_id from public.stock_transfers
    where tenant_id=p_tenant_id and client_transfer_id=p_client_transfer_id;
  if found then return v_transfer_id; end if;
  v_transfer_id := gen_random_uuid();
  if p_source_location_id is null or p_destination_location_id is null
     or p_source_location_id = p_destination_location_id then
    raise exception 'Choose two different locations';
  end if;
  if not exists(select 1 from public.stock_locations
    where id=p_source_location_id and tenant_id=p_tenant_id and is_active=true)
    or not exists(select 1 from public.stock_locations
    where id=p_destination_location_id and tenant_id=p_tenant_id and is_active=true) then
    raise exception 'Source or destination location is unavailable';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Transfer items must be an array';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'A transfer must contain between 1 and 100 lines';
  end if;

  v_transfer_number := 'TRF-' || to_char(now(),'YYYYMMDD') || '-' ||
    upper(substr(replace(v_transfer_id::text,'-',''),1,8));

  insert into public.stock_transfers(
    id,tenant_id,source_location_id,destination_location_id,transfer_number,notes,client_transfer_id,created_by
  ) values (
    v_transfer_id,p_tenant_id,p_source_location_id,p_destination_location_id,
    v_transfer_number,left(trim(coalesce(p_notes,'')),1000),p_client_transfer_id,auth.uid()
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    if coalesce(v_item->>'product_id','') !~* '^[0-9a-f-]{36}$' then
      raise exception 'Invalid product identifier';
    end if;
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 or v_quantity > 1000000000 then
      raise exception 'Invalid transfer quantity';
    end if;
    if not exists(select 1 from public.products
      where id=v_product_id and tenant_id=p_tenant_id and is_active=true) then
      raise exception 'Product is unavailable or belongs to another company';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      p_tenant_id::text || ':' || p_source_location_id::text || ':' || v_product_id::text,0
    ));
    select coalesce(sum(quantity_delta),0)::numeric(14,3) into v_available
      from public.stock_movements
      where tenant_id=p_tenant_id and location_id=p_source_location_id and product_id=v_product_id;
    if v_available < v_quantity then
      raise exception 'Insufficient source stock for product %. Available: %',v_product_id,v_available;
    end if;
    insert into public.stock_transfer_items(tenant_id,transfer_id,product_id,quantity)
      values(p_tenant_id,v_transfer_id,v_product_id,v_quantity);
  end loop;

  return v_transfer_id;
end;
$$;

create or replace function public.ship_stock_transfer(p_transfer_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_item public.stock_transfer_items%rowtype;
  v_available numeric(14,3);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_transfer from public.stock_transfers where id=p_transfer_id for update;
  if not found or v_transfer.status <> 'draft' then
    raise exception 'Transfer is unavailable or already dispatched';
  end if;
  if not public.has_tenant_role(v_transfer.tenant_id,array['owner','admin','manager','stock']::public.tenant_role[]) then
    raise exception 'Permission denied to dispatch this transfer';
  end if;

  for v_item in
    select * from public.stock_transfer_items
    where tenant_id=v_transfer.tenant_id and transfer_id=v_transfer.id
    order by product_id for update
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      v_transfer.tenant_id::text || ':' || v_transfer.source_location_id::text || ':' || v_item.product_id::text,0
    ));
    select coalesce(sum(quantity_delta),0)::numeric(14,3) into v_available
      from public.stock_movements
      where tenant_id=v_transfer.tenant_id and location_id=v_transfer.source_location_id and product_id=v_item.product_id;
    if v_available < v_item.quantity then
      raise exception 'Insufficient stock at dispatch for product %. Available: %',v_item.product_id,v_available;
    end if;
    insert into public.stock_movements(
      tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by
    ) values (
      v_transfer.tenant_id,v_transfer.source_location_id,v_item.product_id,'transfer_out',
      -v_item.quantity,v_transfer.transfer_number,'Expédition vers '||v_transfer.destination_location_id::text,auth.uid()
    );
  end loop;

  update public.stock_transfers
    set status='shipped',shipped_by=auth.uid(),shipped_at=now()
    where id=v_transfer.id and tenant_id=v_transfer.tenant_id;
  return v_transfer.id;
end;
$$;

create or replace function public.receive_stock_transfer(
  p_transfer_id uuid,
  p_client_receipt_id uuid,
  p_items jsonb,
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_item public.stock_transfer_items%rowtype;
  v_input jsonb;
  v_item_id uuid;
  v_quantity numeric(14,3);
  v_remaining numeric(14,3);
  v_receipt_id uuid;
  v_receipt_number text;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_transfer from public.stock_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if not public.has_tenant_role(v_transfer.tenant_id,array['owner','admin','manager','stock']::public.tenant_role[]) then
    raise exception 'Permission denied to receive this transfer';
  end if;
  if p_client_receipt_id is null then raise exception 'Receipt idempotency key is required'; end if;
  select id into v_receipt_id from public.stock_transfer_receipts
    where tenant_id=v_transfer.tenant_id and client_receipt_id=p_client_receipt_id;
  if found then return v_receipt_id; end if;
  if v_transfer.status not in ('shipped','partially_received') then
    raise exception 'Only dispatched transfers can be received';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Receipt items must be an array';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Receipt must contain between 1 and 100 lines';
  end if;

  v_receipt_id := gen_random_uuid();
  v_receipt_number := 'TRR-' || to_char(now(),'YYYYMMDD') || '-' ||
    upper(substr(replace(v_receipt_id::text,'-',''),1,8));
  insert into public.stock_transfer_receipts(
    id,tenant_id,transfer_id,receipt_number,client_receipt_id,received_by,notes
  ) values (
    v_receipt_id,v_transfer.tenant_id,v_transfer.id,v_receipt_number,p_client_receipt_id,auth.uid(),
    left(trim(coalesce(p_notes,'')),1000)
  );

  for v_input in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    if coalesce(v_input->>'transfer_item_id','') !~* '^[0-9a-f-]{36}$' then
      raise exception 'Invalid transfer line identifier';
    end if;
    v_item_id := (v_input->>'transfer_item_id')::uuid;
    v_quantity := (v_input->>'quantity')::numeric;
    select * into v_item from public.stock_transfer_items
      where id=v_item_id and tenant_id=v_transfer.tenant_id and transfer_id=v_transfer.id
      for update;
    if not found then raise exception 'Transfer line not found'; end if;
    v_remaining := v_item.quantity - v_item.received_quantity;
    if v_quantity is null or v_quantity <= 0 or v_quantity > v_remaining then
      raise exception 'Received quantity exceeds remaining quantity for product %',v_item.product_id;
    end if;

    insert into public.stock_transfer_receipt_items(
      tenant_id,receipt_id,transfer_item_id,product_id,quantity
    ) values (v_transfer.tenant_id,v_receipt_id,v_item.id,v_item.product_id,v_quantity);

    insert into public.stock_movements(
      tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by
    ) values (
      v_transfer.tenant_id,v_transfer.destination_location_id,v_item.product_id,'transfer_in',
      v_quantity,v_receipt_number,'Réception du transfert '||v_transfer.transfer_number,auth.uid()
    );

    update public.stock_transfer_items
      set received_quantity=received_quantity+v_quantity
      where id=v_item.id and tenant_id=v_transfer.tenant_id;
  end loop;

  if v_count=0 then raise exception 'Empty transfer receipt'; end if;
  if exists(select 1 from public.stock_transfer_items
    where tenant_id=v_transfer.tenant_id and transfer_id=v_transfer.id
      and received_quantity < quantity) then
    update public.stock_transfers
      set status='partially_received',received_by=auth.uid(),received_at=now()
      where id=v_transfer.id and tenant_id=v_transfer.tenant_id;
  else
    update public.stock_transfers
      set status='received',received_by=auth.uid(),received_at=now()
      where id=v_transfer.id and tenant_id=v_transfer.tenant_id;
  end if;
  return v_receipt_id;
end;
$$;

revoke all on function public.create_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.create_stock_transfer(uuid,uuid,uuid,jsonb,uuid,text) to authenticated;
revoke all on function public.ship_stock_transfer(uuid) from public,anon,authenticated;
grant execute on function public.ship_stock_transfer(uuid) to authenticated;
revoke all on function public.receive_stock_transfer(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.receive_stock_transfer(uuid,uuid,jsonb,text) to authenticated;

revoke all on function public.capture_tenant_audit_log() from public,anon,authenticated;
drop trigger if exists tenant_audit_log on public.stock_transfers;
create trigger tenant_audit_log after insert or update or delete on public.stock_transfers
  for each row execute function public.capture_tenant_audit_log();
drop trigger if exists tenant_audit_log on public.stock_transfer_items;
create trigger tenant_audit_log after insert or update or delete on public.stock_transfer_items
  for each row execute function public.capture_tenant_audit_log();
drop trigger if exists tenant_audit_log on public.stock_transfer_receipts;
create trigger tenant_audit_log after insert or update or delete on public.stock_transfer_receipts
  for each row execute function public.capture_tenant_audit_log();
drop trigger if exists tenant_audit_log on public.stock_transfer_receipt_items;
create trigger tenant_audit_log after insert or update or delete on public.stock_transfer_receipt_items
  for each row execute function public.capture_tenant_audit_log();
