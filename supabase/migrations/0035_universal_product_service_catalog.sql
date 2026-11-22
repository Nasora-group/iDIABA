-- Universal catalog: distinguish physical goods from services.
-- Existing catalog rows remain physical, stock-tracked products by default.
alter table public.products
  add column if not exists product_kind text not null default 'product',
  add column if not exists track_stock boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_product_kind_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products add constraint products_product_kind_check
      check (product_kind in ('product','service') and (product_kind <> 'service' or track_stock = false));
  end if;
end $$;

create index if not exists products_tenant_track_stock_idx
  on public.products(tenant_id, is_active, name)
  where track_stock = true;

create or replace function public.guard_tracked_product_reference()
returns trigger language plpgsql security invoker set search_path = public
as $$
declare v_track_stock boolean;
begin
  select p.track_stock into v_track_stock
  from public.products p
  where p.id = new.product_id and p.tenant_id = new.tenant_id;
  if not found or not v_track_stock then
    raise exception 'Stock operations require a stock-tracked product';
  end if;
  return new;
end;
$$;

drop trigger if exists stock_movements_require_tracked_product on public.stock_movements;
create trigger stock_movements_require_tracked_product
  before insert on public.stock_movements
  for each row execute function public.guard_tracked_product_reference();

drop trigger if exists purchase_order_items_require_tracked_product on public.purchase_order_items;
create trigger purchase_order_items_require_tracked_product
  before insert or update of tenant_id, product_id on public.purchase_order_items
  for each row execute function public.guard_tracked_product_reference();

drop trigger if exists inventory_count_items_require_tracked_product on public.inventory_count_items;
create trigger inventory_count_items_require_tracked_product
  before insert or update of tenant_id, product_id on public.inventory_count_items
  for each row execute function public.guard_tracked_product_reference();

drop trigger if exists stock_transfer_items_require_tracked_product on public.stock_transfer_items;
create trigger stock_transfer_items_require_tracked_product
  before insert or update of tenant_id, product_id on public.stock_transfer_items
  for each row execute function public.guard_tracked_product_reference();

drop trigger if exists stock_transfer_receipt_items_require_tracked_product on public.stock_transfer_receipt_items;
create trigger stock_transfer_receipt_items_require_tracked_product
  before insert or update of tenant_id, product_id on public.stock_transfer_receipt_items
  for each row execute function public.guard_tracked_product_reference();

revoke all on function public.guard_tracked_product_reference() from public, anon, authenticated;

create or replace function public.finalize_sale(
  p_tenant_id uuid,
  p_location_id uuid,
  p_cash_session_id uuid,
  p_client_sale_id uuid,
  p_items jsonb,
  p_payments jsonb
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  v_sale_id uuid;
  v_session public.cash_sessions%rowtype;
  v_item jsonb;
  v_payment jsonb;
  v_product public.products%rowtype;
  v_qty numeric(14,3);
  v_subtotal numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_line_subtotal numeric(14,2);
  v_line_tax numeric(14,2);
  v_payment_total numeric(14,2) := 0;
  v_method text;
  v_amount numeric(14,2);
  v_reference text;
begin
  if auth.uid() is null or not public.has_tenant_role(p_tenant_id,array['owner','admin','manager','cashier']::public.tenant_role[]) then
    raise exception 'Permission denied to checkout';
  end if;
  if p_client_sale_id is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0
     or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments)=0 then
    raise exception 'A sale requires items and payments';
  end if;

  select * into v_session from public.cash_sessions
    where id=p_cash_session_id and tenant_id=p_tenant_id and location_id=p_location_id
    for update;
  if not found or v_session.status <> 'open' then raise exception 'Cash session is not open for this location'; end if;
  if v_session.opened_by <> auth.uid() and not public.has_tenant_role(p_tenant_id,array['owner','admin','manager']::public.tenant_role[]) then
    raise exception 'This cash session belongs to another cashier';
  end if;

  insert into public.sales(tenant_id,location_id,cash_session_id,cashier_id,client_sale_id)
    values(p_tenant_id,p_location_id,p_cash_session_id,auth.uid(),p_client_sale_id)
    on conflict (tenant_id,client_sale_id) do nothing returning id into v_sale_id;
  if v_sale_id is null then
    select id into v_sale_id from public.sales where tenant_id=p_tenant_id and client_sale_id=p_client_sale_id;
    return v_sale_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'product_id','') !~* '^[0-9a-f-]{36}$' then raise exception 'Invalid product identifier'; end if;
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then raise exception 'Invalid product quantity'; end if;
    select * into v_product from public.products
      where id=(v_item->>'product_id')::uuid and tenant_id=p_tenant_id and is_active=true;
    if not found then raise exception 'Product not found or inactive'; end if;

    v_line_subtotal := round(v_qty * v_product.sale_price,2);
    v_line_tax := round(v_line_subtotal * v_product.tax_rate / 100,2);
    insert into public.sale_items(tenant_id,sale_id,product_id,product_name,sku,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total)
      values(p_tenant_id,v_sale_id,v_product.id,v_product.name,v_product.sku,v_qty,v_product.sale_price,v_product.tax_rate,
             v_line_subtotal,v_line_tax,v_line_subtotal+v_line_tax);
    if v_product.track_stock then
      insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
        values(p_tenant_id,p_location_id,v_product.id,'sale',-v_qty,'SALE-'||v_sale_id::text,'Vente caisse',auth.uid());
    end if;
    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax := v_tax + v_line_tax;
  end loop;

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    v_method := v_payment->>'method';
    v_amount := (v_payment->>'amount')::numeric;
    v_reference := left(trim(coalesce(v_payment->>'reference','')),160);
    if v_method not in ('cash','mobile_money','card','bank_transfer','wave','orange_money') or v_amount is null or v_amount <= 0 then
      raise exception 'Invalid payment line';
    end if;
    if v_method in ('wave','orange_money') and length(v_reference) < 4 then
      raise exception 'Mobile money transaction reference is required';
    end if;
    v_payment_total := v_payment_total + round(v_amount,2);
    insert into public.sale_payments(tenant_id,sale_id,payment_method,amount,payment_reference)
      values(p_tenant_id,v_sale_id,v_method,round(v_amount,2),nullif(v_reference,''));
  end loop;

  if round(v_payment_total,2) <> round(v_subtotal+v_tax,2) then
    raise exception 'Payment total must exactly match the sale total';
  end if;
  update public.sales set subtotal=v_subtotal,tax_total=v_tax,total=v_subtotal+v_tax,
    status='completed',completed_at=now() where id=v_sale_id and tenant_id=p_tenant_id;
  return v_sale_id;
end;
$$;
