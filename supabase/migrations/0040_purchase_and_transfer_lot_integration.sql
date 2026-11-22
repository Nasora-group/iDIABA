-- iDIABA Sprint 40: integrate lot traceability into supplier receipts and warehouse transfers.
-- Additive only: existing purchase/transfer records and stock history remain intact.
create table if not exists public.stock_transfer_lot_allocations (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  transfer_item_id uuid not null, source_lot_id uuid not null,
  shipped_quantity numeric(14,3) not null check (shipped_quantity > 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0 and received_quantity <= shipped_quantity),
  destination_lot_id uuid, created_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,transfer_item_id,source_lot_id),
  foreign key (tenant_id,transfer_item_id) references public.stock_transfer_items(tenant_id,id),
  foreign key (tenant_id,source_lot_id) references public.stock_lots(tenant_id,id),
  foreign key (tenant_id,destination_lot_id) references public.stock_lots(tenant_id,id)
);
alter table public.stock_transfer_lot_allocations enable row level security;
create policy "members read stock transfer lot allocations" on public.stock_transfer_lot_allocations
  for select to authenticated using (public.is_tenant_member(tenant_id));
grant select on public.stock_transfer_lot_allocations to authenticated;
create index if not exists stock_transfer_lot_allocations_item_idx
  on public.stock_transfer_lot_allocations(tenant_id,transfer_item_id);

create or replace function public.receive_purchase_order(p_purchase_order_id uuid,p_items jsonb,p_notes text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_order public.purchase_orders%rowtype; v_item jsonb; v_line public.purchase_order_items%rowtype;
  v_product public.products%rowtype; v_quantity numeric(14,3); v_receipt_id uuid:=gen_random_uuid();
  v_receipt_number text; v_count integer:=0; v_received_total numeric(14,3):=0;
  v_remaining numeric(14,3); v_lot_code text; v_expiry_date date; v_lot_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_order from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not public.has_tenant_role(v_order.tenant_id,array['owner','admin','manager','stock']::public.tenant_role[]) then raise exception 'Insufficient permissions'; end if;
  if v_order.status not in ('ordered','partially_received') then raise exception 'Order cannot be received'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then raise exception 'Receipt must contain at least one line'; end if;
  v_receipt_number:='REC-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_receipt_id::text,'-',''),1,8));
  insert into public.purchase_receipts(id,tenant_id,purchase_order_id,location_id,receipt_number,received_by,notes)
  values(v_receipt_id,v_order.tenant_id,v_order.id,v_order.location_id,v_receipt_number,auth.uid(),left(coalesce(p_notes,''),1000));
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_count:=v_count+1;
    select * into v_line from public.purchase_order_items where id=(v_item->>'order_item_id')::uuid
      and tenant_id=v_order.tenant_id and purchase_order_id=v_order.id for update;
    if not found then raise exception 'Order line not found'; end if;
    select * into v_product from public.products where id=v_line.product_id and tenant_id=v_order.tenant_id;
    if not found then raise exception 'Product not found'; end if;
    v_quantity:=(v_item->>'quantity')::numeric; v_remaining:=v_line.quantity-v_line.received_quantity;
    if v_quantity is null or v_quantity<=0 or v_quantity>v_remaining then raise exception 'Received quantity exceeds remaining quantity'; end if;
    insert into public.purchase_receipt_items(tenant_id,receipt_id,purchase_order_item_id,product_id,quantity,unit_cost)
    values(v_order.tenant_id,v_receipt_id,v_line.id,v_line.product_id,v_quantity,v_line.unit_cost);
    if v_product.track_lots then
      v_lot_code:=trim(coalesce(v_item->>'lot_code',''));
      if length(v_lot_code) not between 1 and 80 then raise exception 'Lot number is required for lot-tracked products'; end if;
      if coalesce(v_item->>'expiry_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'A valid expiry date is required for lot-tracked products'; end if;
      v_expiry_date:=(v_item->>'expiry_date')::date;
      if v_expiry_date<current_date then raise exception 'Cannot receive an already expired lot'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_order.tenant_id::text||':'||v_order.location_id::text||':'||v_line.product_id::text,0));
      insert into public.stock_lots(tenant_id,product_id,location_id,lot_code,expiry_date,created_by)
      values(v_order.tenant_id,v_line.product_id,v_order.location_id,v_lot_code,v_expiry_date,auth.uid())
      on conflict(tenant_id,product_id,location_id,lot_code) do update set expiry_date=excluded.expiry_date
        where public.stock_lots.expiry_date=excluded.expiry_date returning id into v_lot_id;
      if v_lot_id is null then raise exception 'Lot code already exists with a different expiry date'; end if;
      insert into public.stock_movements(tenant_id,location_id,product_id,lot_id,movement_type,quantity_delta,reference,note,created_by)
      values(v_order.tenant_id,v_order.location_id,v_line.product_id,v_lot_id,'receipt',v_quantity,v_order.order_number,'Réception '||v_receipt_number,auth.uid());
    else
      if coalesce(v_item->>'lot_code','')<>'' or coalesce(v_item->>'expiry_date','')<>'' then raise exception 'Lot fields are only accepted for products with lot tracking enabled'; end if;
      insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
      values(v_order.tenant_id,v_order.location_id,v_line.product_id,'receipt',v_quantity,v_order.order_number,'Réception '||v_receipt_number,auth.uid());
    end if;
    update public.purchase_order_items set received_quantity=received_quantity+v_quantity where id=v_line.id and tenant_id=v_order.tenant_id;
    v_received_total:=v_received_total+v_quantity;
  end loop;
  if v_count=0 or v_received_total<=0 then raise exception 'Empty receipt'; end if;
  if exists(select 1 from public.purchase_order_items i where i.tenant_id=v_order.tenant_id and i.purchase_order_id=v_order.id and i.received_quantity<i.quantity) then
    update public.purchase_orders set status='partially_received',updated_at=now() where id=v_order.id and tenant_id=v_order.tenant_id;
  else update public.purchase_orders set status='received',updated_at=now() where id=v_order.id and tenant_id=v_order.tenant_id; end if;
  return v_receipt_id;
end; $$;
revoke all on function public.receive_purchase_order(uuid,jsonb,text) from public,anon;
grant execute on function public.receive_purchase_order(uuid,jsonb,text) to authenticated;

create or replace function public.ship_stock_transfer(p_transfer_id uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_transfer public.stock_transfers%rowtype; v_item public.stock_transfer_items%rowtype;
  v_available numeric(14,3); v_movement_id uuid; v_lot_row record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_transfer from public.stock_transfers where id=p_transfer_id for update;
  if not found or v_transfer.status<>'draft' then raise exception 'Transfer is unavailable or already dispatched'; end if;
  if not public.has_tenant_role(v_transfer.tenant_id,array['owner','admin','manager','stock']::public.tenant_role[]) then raise exception 'Permission denied to dispatch this transfer'; end if;
  for v_item in select * from public.stock_transfer_items where tenant_id=v_transfer.tenant_id and transfer_id=v_transfer.id order by product_id for update loop
    perform pg_advisory_xact_lock(hashtextextended(v_transfer.tenant_id::text||':'||v_transfer.source_location_id::text||':'||v_item.product_id::text,0));
    select coalesce(sum(quantity_delta),0)::numeric(14,3) into v_available from public.stock_movements
      where tenant_id=v_transfer.tenant_id and location_id=v_transfer.source_location_id and product_id=v_item.product_id;
    if v_available<v_item.quantity then raise exception 'Insufficient stock at dispatch for product %. Available: %',v_item.product_id,v_available; end if;
    insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
    values(v_transfer.tenant_id,v_transfer.source_location_id,v_item.product_id,'transfer_out',-v_item.quantity,v_transfer.transfer_number,
      'Expédition vers '||v_transfer.destination_location_id::text,auth.uid()) returning id into v_movement_id;
    for v_lot_row in select lm.lot_id,abs(lm.quantity_delta)::numeric(14,3) as allocated
      from public.stock_lot_movements lm where lm.tenant_id=v_transfer.tenant_id and lm.stock_movement_id=v_movement_id and lm.quantity_delta<0
      order by lm.lot_id loop
      insert into public.stock_transfer_lot_allocations(tenant_id,transfer_item_id,source_lot_id,shipped_quantity)
      values(v_transfer.tenant_id,v_item.id,v_lot_row.lot_id,v_lot_row.allocated);
    end loop;
  end loop;
  update public.stock_transfers set status='shipped',shipped_by=auth.uid(),shipped_at=now() where id=v_transfer.id and tenant_id=v_transfer.tenant_id;
  return v_transfer.id;
end; $$;
revoke all on function public.ship_stock_transfer(uuid) from public,anon,authenticated;
grant execute on function public.ship_stock_transfer(uuid) to authenticated;

create or replace function public.receive_stock_transfer(p_transfer_id uuid,p_client_receipt_id uuid,p_items jsonb,p_notes text default '')
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_transfer public.stock_transfers%rowtype; v_item public.stock_transfer_items%rowtype; v_input jsonb;
  v_item_id uuid; v_quantity numeric(14,3); v_remaining numeric(14,3); v_to_allocate numeric(14,3);
  v_take numeric(14,3); v_receipt_id uuid; v_receipt_number text; v_count integer:=0;
  v_product public.products%rowtype; v_allocation record; v_source_lot public.stock_lots%rowtype; v_destination_lot_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_transfer from public.stock_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if not public.has_tenant_role(v_transfer.tenant_id,array['owner','admin','manager','stock']::public.tenant_role[]) then raise exception 'Permission denied to receive this transfer'; end if;
  if p_client_receipt_id is null then raise exception 'Receipt idempotency key is required'; end if;
  select id into v_receipt_id from public.stock_transfer_receipts where tenant_id=v_transfer.tenant_id and client_receipt_id=p_client_receipt_id;
  if found then return v_receipt_id; end if;
  if v_transfer.status not in ('shipped','partially_received') then raise exception 'Only dispatched transfers can be received'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then raise exception 'Receipt must contain between 1 and 100 lines'; end if;
  v_receipt_id:=gen_random_uuid();
  v_receipt_number:='TRR-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_receipt_id::text,'-',''),1,8));
  insert into public.stock_transfer_receipts(id,tenant_id,transfer_id,receipt_number,client_receipt_id,received_by,notes)
  values(v_receipt_id,v_transfer.tenant_id,v_transfer.id,v_receipt_number,p_client_receipt_id,auth.uid(),left(trim(coalesce(p_notes,'')),1000));
  for v_input in select value from jsonb_array_elements(p_items) loop
    v_count:=v_count+1;
    if coalesce(v_input->>'transfer_item_id','') !~* '^[0-9a-f-]{36}$' then raise exception 'Invalid transfer line identifier'; end if;
    v_item_id:=(v_input->>'transfer_item_id')::uuid; v_quantity:=(v_input->>'quantity')::numeric;
    select * into v_item from public.stock_transfer_items where id=v_item_id and tenant_id=v_transfer.tenant_id and transfer_id=v_transfer.id for update;
    if not found then raise exception 'Transfer line not found'; end if;
    v_remaining:=v_item.quantity-v_item.received_quantity;
    if v_quantity is null or v_quantity<=0 or v_quantity>v_remaining then raise exception 'Received quantity exceeds remaining quantity for product %',v_item.product_id; end if;
    select * into v_product from public.products where id=v_item.product_id and tenant_id=v_transfer.tenant_id;
    if not found then raise exception 'Product not found'; end if;
    insert into public.stock_transfer_receipt_items(tenant_id,receipt_id,transfer_item_id,product_id,quantity)
    values(v_transfer.tenant_id,v_receipt_id,v_item.id,v_item.product_id,v_quantity);
    if v_product.track_lots then
      v_to_allocate:=v_quantity;
      for v_allocation in select a.id,a.source_lot_id,a.shipped_quantity,a.received_quantity,a.destination_lot_id
        from public.stock_transfer_lot_allocations a join public.stock_lots sl on sl.id=a.source_lot_id and sl.tenant_id=a.tenant_id
        where a.tenant_id=v_transfer.tenant_id and a.transfer_item_id=v_item.id and a.received_quantity<a.shipped_quantity
        order by sl.expiry_date,sl.received_at,a.id for update of a loop
        exit when v_to_allocate<=0;
        v_take:=least(v_to_allocate,v_allocation.shipped_quantity-v_allocation.received_quantity);
        select * into v_source_lot from public.stock_lots where id=v_allocation.source_lot_id and tenant_id=v_transfer.tenant_id;
        if v_allocation.destination_lot_id is null then
          insert into public.stock_lots(tenant_id,product_id,location_id,lot_code,expiry_date,created_by)
          values(v_transfer.tenant_id,v_item.product_id,v_transfer.destination_location_id,v_source_lot.lot_code,v_source_lot.expiry_date,auth.uid())
          on conflict(tenant_id,product_id,location_id,lot_code) do update set expiry_date=excluded.expiry_date
            where public.stock_lots.expiry_date=excluded.expiry_date returning id into v_destination_lot_id;
          if v_destination_lot_id is null then raise exception 'Destination lot code conflicts with a different expiry date'; end if;
          update public.stock_transfer_lot_allocations set destination_lot_id=v_destination_lot_id where id=v_allocation.id and tenant_id=v_transfer.tenant_id;
        else v_destination_lot_id:=v_allocation.destination_lot_id; end if;
        insert into public.stock_movements(tenant_id,location_id,product_id,lot_id,movement_type,quantity_delta,reference,note,created_by)
        values(v_transfer.tenant_id,v_transfer.destination_location_id,v_item.product_id,v_destination_lot_id,'transfer_in',
          v_take,v_receipt_number,'Réception du lot '||v_source_lot.lot_code||' du transfert '||v_transfer.transfer_number,auth.uid());
        update public.stock_transfer_lot_allocations set received_quantity=received_quantity+v_take where id=v_allocation.id and tenant_id=v_transfer.tenant_id;
        v_to_allocate:=v_to_allocate-v_take;
      end loop;
      if v_to_allocate>0 then raise exception 'Lot allocation is missing for shipped quantity'; end if;
    else
      insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
      values(v_transfer.tenant_id,v_transfer.destination_location_id,v_item.product_id,'transfer_in',v_quantity,v_receipt_number,
        'Réception du transfert '||v_transfer.transfer_number,auth.uid());
    end if;
    update public.stock_transfer_items set received_quantity=received_quantity+v_quantity where id=v_item.id and tenant_id=v_transfer.tenant_id;
  end loop;
  if v_count=0 then raise exception 'Empty transfer receipt'; end if;
  if exists(select 1 from public.stock_transfer_items where tenant_id=v_transfer.tenant_id and transfer_id=v_transfer.id and received_quantity<quantity) then
    update public.stock_transfers set status='partially_received',received_by=auth.uid(),received_at=now() where id=v_transfer.id and tenant_id=v_transfer.tenant_id;
  else update public.stock_transfers set status='received',received_by=auth.uid(),received_at=now() where id=v_transfer.id and tenant_id=v_transfer.tenant_id; end if;
  return v_receipt_id;
end; $$;
revoke all on function public.receive_stock_transfer(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.receive_stock_transfer(uuid,uuid,jsonb,text) to authenticated;
