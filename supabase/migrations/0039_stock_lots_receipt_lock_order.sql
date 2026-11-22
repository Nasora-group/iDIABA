-- Serialize the first lot-tracked receipt with stock movements for the same product/location.
-- Keep lock order consistent with stock_movement_guard and FEFO allocation.
create or replace function public.receive_stock_lot(
  p_tenant_id uuid,p_product_id uuid,p_location_id uuid,p_lot_code text,
  p_expiry_date date,p_quantity numeric,p_note text default ''
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_lot_id uuid; v_current numeric(14,3);
begin
  if auth.uid() is null or not public.has_tenant_role(
    p_tenant_id,array['owner','admin','manager','stock']::public.tenant_role[]
  ) then raise exception 'Insufficient permissions'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000 then raise exception 'Invalid lot quantity'; end if;
  if p_lot_code is null or length(trim(p_lot_code)) not between 1 and 80 then raise exception 'Invalid lot code'; end if;
  if p_expiry_date is null then raise exception 'Expiry date is required'; end if;
  if not exists(select 1 from public.products p where p.id=p_product_id and p.tenant_id=p_tenant_id and p.is_active and p.track_stock) then
    raise exception 'Stock-tracked product unavailable';
  end if;
  if not exists(select 1 from public.stock_locations l where l.id=p_location_id and l.tenant_id=p_tenant_id and l.is_active) then
    raise exception 'Stock location unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_location_id::text || ':' || p_product_id::text,0));

  select coalesce(sum(quantity_on_hand),0) into v_current from public.stock_balances
    where tenant_id=p_tenant_id and product_id=p_product_id;
  if not exists(select 1 from public.products where id=p_product_id and tenant_id=p_tenant_id and track_lots)
     and v_current > 0 then
    raise exception 'Existing stock must be inventoried by lot before lot tracking can be enabled';
  end if;
  update public.products set track_lots=true where id=p_product_id and tenant_id=p_tenant_id;
  insert into public.stock_lots(tenant_id,product_id,location_id,lot_code,expiry_date,created_by)
    values(p_tenant_id,p_product_id,p_location_id,trim(p_lot_code),p_expiry_date,auth.uid())
    on conflict (tenant_id,product_id,location_id,lot_code)
    do update set expiry_date=excluded.expiry_date
    where public.stock_lots.expiry_date=excluded.expiry_date returning id into v_lot_id;
  if v_lot_id is null then raise exception 'Lot code already exists with a different expiry date'; end if;
  insert into public.stock_movements(tenant_id,location_id,product_id,lot_id,movement_type,quantity_delta,reference,note,created_by)
    values(p_tenant_id,p_location_id,p_product_id,v_lot_id,'receipt',p_quantity,
      'LOT-'||trim(p_lot_code),left(coalesce(p_note,''),500),auth.uid());
  return v_lot_id;
end;
$$;
