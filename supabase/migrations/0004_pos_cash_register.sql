-- iDIABA Sprint 4: POS sales, cashier sessions and immutable receipts.
-- All monetary values are exact NUMERIC values. Checkout is one database transaction.
create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  opened_by uuid not null references auth.users(id),
  closed_by uuid references auth.users(id),
  opening_cash numeric(14,2) not null default 0 check (opening_cash >= 0),
  expected_cash numeric(14,2),
  closing_cash numeric(14,2),
  cash_variance numeric(14,2),
  status text not null default 'open' check (status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, id),
  constraint cash_session_location_tenant_fk foreign key (tenant_id, location_id)
    references public.stock_locations(tenant_id, id),
  check (
    (status = 'open' and closed_at is null and closing_cash is null)
    or (status = 'closed' and closed_at is not null and closing_cash is not null and expected_cash is not null)
  )
);
create unique index if not exists one_open_cash_session_per_cashier_location
  on public.cash_sessions(tenant_id, location_id, opened_by) where status = 'open';
create index if not exists cash_sessions_tenant_status_idx
  on public.cash_sessions(tenant_id, status, opened_at desc);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  cash_session_id uuid not null,
  cashier_id uuid not null references auth.users(id),
  client_sale_id uuid not null,
  status text not null default 'draft' check (status in ('draft','completed')),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, client_sale_id),
  constraint sales_location_tenant_fk foreign key (tenant_id, location_id)
    references public.stock_locations(tenant_id, id),
  constraint sales_session_tenant_fk foreign key (tenant_id, cash_session_id)
    references public.cash_sessions(tenant_id, id),
  check ((status = 'draft' and completed_at is null) or (status = 'completed' and completed_at is not null))
);
create index if not exists sales_tenant_created_idx on public.sales(tenant_id, created_at desc);
create index if not exists sales_tenant_session_idx on public.sales(tenant_id, cash_session_id, created_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  product_id uuid not null,
  product_name text not null,
  sku text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_rate numeric(5,2) not null check (tax_rate between 0 and 100),
  line_subtotal numeric(14,2) not null check (line_subtotal >= 0),
  line_tax numeric(14,2) not null check (line_tax >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  constraint sale_items_sale_tenant_fk foreign key (tenant_id, sale_id)
    references public.sales(tenant_id, id),
  constraint sale_items_product_tenant_fk foreign key (tenant_id, product_id)
    references public.products(tenant_id, id)
);
create index if not exists sale_items_tenant_sale_idx on public.sale_items(tenant_id, sale_id);

create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  payment_method text not null check (payment_method in ('cash','mobile_money','card','bank_transfer')),
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  constraint sale_payments_sale_tenant_fk foreign key (tenant_id, sale_id)
    references public.sales(tenant_id, id)
);
create index if not exists sale_payments_tenant_sale_idx on public.sale_payments(tenant_id, sale_id);

alter table public.cash_sessions enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.sale_payments enable row level security;

create policy "members read cash sessions" on public.cash_sessions
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "members read sales" on public.sales
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "members read sale items" on public.sale_items
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "members read sale payments" on public.sale_payments
  for select to authenticated using (public.is_tenant_member(tenant_id));

grant select on public.cash_sessions, public.sales, public.sale_items, public.sale_payments to authenticated;

-- A cashier can create sale movements only through the privileged checkout RPC.
create or replace function public.guard_stock_movement()
returns trigger language plpgsql security definer set search_path = public
as $$
declare current_quantity numeric(14,3);
begin
  if new.movement_type in ('sale','sale_return') then
    if not public.has_tenant_role(new.tenant_id, array['owner','admin','manager','cashier']::public.tenant_role[]) then
      raise exception 'Insufficient permissions for sale stock movements';
    end if;
  elsif not public.has_tenant_role(new.tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]) then
    raise exception 'Insufficient permissions to record stock movements';
  end if;

  if not exists (select 1 from public.products p where p.id=new.product_id and p.tenant_id=new.tenant_id and p.is_active=true) then
    raise exception 'Product is unavailable or belongs to another company';
  end if;
  if not exists (select 1 from public.stock_locations l where l.id=new.location_id and l.tenant_id=new.tenant_id and l.is_active=true) then
    raise exception 'Stock location is unavailable or belongs to another company';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.location_id::text || ':' || new.product_id::text, 0));
  select coalesce(sum(sm.quantity_delta),0) into current_quantity
    from public.stock_movements sm
    where sm.tenant_id=new.tenant_id and sm.location_id=new.location_id and sm.product_id=new.product_id;
  if current_quantity + new.quantity_delta < 0 then
    raise exception 'Insufficient stock. Available: %', current_quantity;
  end if;
  return new;
end;
$$;

create or replace function public.open_cash_session(
  p_tenant_id uuid, p_location_id uuid, p_opening_cash numeric
) returns uuid language plpgsql security definer set search_path = public
as $$
declare new_session_id uuid;
begin
  if auth.uid() is null or not public.has_tenant_role(p_tenant_id, array['owner','admin','manager','cashier']::public.tenant_role[]) then
    raise exception 'Permission denied to open a cash session';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 then raise exception 'Opening cash must be non-negative'; end if;
  if not exists (select 1 from public.stock_locations l where l.id=p_location_id and l.tenant_id=p_tenant_id and l.is_active=true) then
    raise exception 'Invalid or inactive stock location';
  end if;
  insert into public.cash_sessions(tenant_id,location_id,opened_by,opening_cash)
    values(p_tenant_id,p_location_id,auth.uid(),round(p_opening_cash,2))
    returning id into new_session_id;
  return new_session_id;
end;
$$;

create or replace function public.close_cash_session(
  p_session_id uuid, p_closing_cash numeric
) returns void language plpgsql security definer set search_path = public
as $$
declare s public.cash_sessions%rowtype; expected numeric(14,2);
begin
  if auth.uid() is null or p_closing_cash is null or p_closing_cash < 0 then raise exception 'Invalid closing cash'; end if;
  select * into s from public.cash_sessions where id=p_session_id for update;
  if not found or s.status <> 'open' then raise exception 'Cash session is not open'; end if;
  if s.opened_by <> auth.uid() and not public.has_tenant_role(s.tenant_id,array['owner','admin','manager']::public.tenant_role[]) then
    raise exception 'Permission denied to close this cash session';
  end if;
  select round(s.opening_cash + coalesce(sum(sp.amount),0),2) into expected
    from public.sale_payments sp
    join public.sales sa on sa.id=sp.sale_id and sa.tenant_id=sp.tenant_id
    where sp.tenant_id=s.tenant_id and sa.cash_session_id=s.id and sa.status='completed' and sp.payment_method='cash';
  update public.cash_sessions set status='closed', closed_by=auth.uid(), closed_at=now(),
    expected_cash=expected, closing_cash=round(p_closing_cash,2),
    cash_variance=round(p_closing_cash-expected,2)
    where id=s.id;
end;
$$;

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
    insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
      values(p_tenant_id,p_location_id,v_product.id,'sale',-v_qty,'SALE-'||v_sale_id::text,'Vente caisse',auth.uid());
    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax := v_tax + v_line_tax;
  end loop;

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    v_method := v_payment->>'method';
    v_amount := (v_payment->>'amount')::numeric;
    if v_method not in ('cash','mobile_money','card','bank_transfer') or v_amount is null or v_amount <= 0 then
      raise exception 'Invalid payment line';
    end if;
    v_payment_total := v_payment_total + round(v_amount,2);
    insert into public.sale_payments(tenant_id,sale_id,payment_method,amount)
      values(p_tenant_id,v_sale_id,v_method,round(v_amount,2));
  end loop;

  if round(v_payment_total,2) <> round(v_subtotal+v_tax,2) then
    raise exception 'Payment total must exactly match the sale total';
  end if;
  update public.sales set subtotal=v_subtotal,tax_total=v_tax,total=v_subtotal+v_tax,
    status='completed',completed_at=now() where id=v_sale_id and tenant_id=p_tenant_id;
  return v_sale_id;
end;
$$;

create or replace function public.guard_sale_header()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Completed sales cannot be deleted'; end if;
  if old.status <> 'draft' or new.status <> 'completed' then
    raise exception 'Completed sales are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists sales_immutable on public.sales;
create trigger sales_immutable before update or delete on public.sales
  for each row execute function public.guard_sale_header();

create or replace function public.prevent_sale_line_mutation()
returns trigger language plpgsql as $$
begin raise exception 'Sale lines and payments are immutable'; end;
$$;
drop trigger if exists sale_items_immutable on public.sale_items;
create trigger sale_items_immutable before update or delete on public.sale_items
  for each row execute function public.prevent_sale_line_mutation();
drop trigger if exists sale_payments_immutable on public.sale_payments;
create trigger sale_payments_immutable before update or delete on public.sale_payments
  for each row execute function public.prevent_sale_line_mutation();

revoke all on function public.open_cash_session(uuid,uuid,numeric) from public;
revoke all on function public.close_cash_session(uuid,numeric) from public;
revoke all on function public.finalize_sale(uuid,uuid,uuid,uuid,jsonb,jsonb) from public;
grant execute on function public.open_cash_session(uuid,uuid,numeric) to authenticated;
grant execute on function public.close_cash_session(uuid,numeric) to authenticated;
grant execute on function public.finalize_sale(uuid,uuid,uuid,uuid,jsonb,jsonb) to authenticated;
