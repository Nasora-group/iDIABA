-- iDIABA Sprint 18: historical unit cost snapshots and gross-margin reporting.
-- Existing sale lines remain NULL: no historical purchase cost is fabricated.
alter table public.sale_items
  add column if not exists unit_cost_snapshot numeric(14,2)
  check (unit_cost_snapshot is null or unit_cost_snapshot >= 0);

create index if not exists sale_items_tenant_cost_known_idx
  on public.sale_items(tenant_id, sale_id)
  where unit_cost_snapshot is not null;

-- Maintain a tenant-wide moving weighted-average purchase cost when goods are received.
-- If legacy stock has no known cost, keep its cost unknown rather than inventing one.
create or replace function public.update_product_weighted_cost_from_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_on_hand numeric(14,3);
  v_new_cost numeric(14,2);
begin
  select * into v_product
  from public.products
  where id = new.product_id and tenant_id = new.tenant_id
  for update;

  if not found then
    raise exception 'Product not found for purchase receipt';
  end if;

  select coalesce(sum(sm.quantity_delta), 0)
    into v_on_hand
  from public.stock_movements sm
  where sm.tenant_id = new.tenant_id
    and sm.product_id = new.product_id;

  if v_on_hand <= 0 then
    v_new_cost := new.unit_cost;
  elsif v_product.purchase_price > 0 then
    v_new_cost := round(
      ((v_on_hand * v_product.purchase_price) + (new.quantity * new.unit_cost))
      / (v_on_hand + new.quantity),
      2
    );
  else
    -- Existing stock has no reliable cost; do not contaminate its valuation.
    v_new_cost := 0;
  end if;

  if v_new_cost <> v_product.purchase_price then
    update public.products
    set purchase_price = v_new_cost, updated_at = now()
    where id = new.product_id and tenant_id = new.tenant_id;
  end if;

  return new;
end;
$$;

drop trigger if exists purchase_receipt_weighted_cost_before_insert on public.purchase_receipt_items;
create trigger purchase_receipt_weighted_cost_before_insert
  before insert on public.purchase_receipt_items
  for each row execute function public.update_product_weighted_cost_from_receipt();

-- Snapshot the current known weighted-average cost at checkout.
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
      where id=(v_item->>'product_id')::uuid and tenant_id=p_tenant_id and is_active=true
      for share;
    if not found then raise exception 'Product not found or inactive'; end if;

    v_line_subtotal := round(v_qty * v_product.sale_price,2);
    v_line_tax := round(v_line_subtotal * v_product.tax_rate / 100,2);
    insert into public.sale_items(tenant_id,sale_id,product_id,product_name,sku,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total,unit_cost_snapshot)
      values(p_tenant_id,v_sale_id,v_product.id,v_product.name,v_product.sku,v_qty,v_product.sale_price,v_product.tax_rate,
             v_line_subtotal,v_line_tax,v_line_subtotal+v_line_tax,nullif(v_product.purchase_price,0));
    insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
      values(p_tenant_id,p_location_id,v_product.id,'sale',-v_qty,'SALE-'||v_sale_id::text,'Vente caisse',auth.uid());
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

-- Add cost coverage and gross-margin figures to the existing management report.
create or replace function public.get_tenant_management_report(
  p_tenant_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null
     or not public.has_tenant_role(p_tenant_id,array['owner','admin']::public.tenant_role[]) then
    raise exception 'Accès réservé aux propriétaires et administrateurs';
  end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '366 days' then
    raise exception 'Période de rapport invalide (maximum 366 jours)';
  end if;

  select jsonb_build_object(
    'revenue',coalesce(sum(s.total),0),
    'sales_count',count(s.id),
    'average_ticket',coalesce(avg(s.total),0),
    'costed_revenue',coalesce((
      select sum(si.line_subtotal)
      from public.sale_items si
      join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id
      where si.tenant_id=p_tenant_id and parent.status='completed'
        and parent.completed_at>=p_from and parent.completed_at<p_to
        and si.unit_cost_snapshot is not null
    ),0),
    'cost_of_goods_sold',coalesce((
      select sum(si.quantity*si.unit_cost_snapshot)
      from public.sale_items si
      join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id
      where si.tenant_id=p_tenant_id and parent.status='completed'
        and parent.completed_at>=p_from and parent.completed_at<p_to
        and si.unit_cost_snapshot is not null
    ),0),
    'gross_margin',coalesce((
      select sum(si.line_subtotal-(si.quantity*si.unit_cost_snapshot))
      from public.sale_items si
      join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id
      where si.tenant_id=p_tenant_id and parent.status='completed'
        and parent.completed_at>=p_from and parent.completed_at<p_to
        and si.unit_cost_snapshot is not null
    ),0),
    'gross_margin_rate',coalesce((
      select case when sum(si.line_subtotal)>0
        then round(100*sum(si.line_subtotal-(si.quantity*si.unit_cost_snapshot))/sum(si.line_subtotal),2)
        else 0 end
      from public.sale_items si
      join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id
      where si.tenant_id=p_tenant_id and parent.status='completed'
        and parent.completed_at>=p_from and parent.completed_at<p_to
        and si.unit_cost_snapshot is not null
    ),0),
    'costed_lines',(
      select count(*) from public.sale_items si
      join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id
      where si.tenant_id=p_tenant_id and parent.status='completed'
        and parent.completed_at>=p_from and parent.completed_at<p_to
        and si.unit_cost_snapshot is not null
    ),
    'uncosted_lines',(
      select count(*) from public.sale_items si
      join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id
      where si.tenant_id=p_tenant_id and parent.status='completed'
        and parent.completed_at>=p_from and parent.completed_at<p_to
        and si.unit_cost_snapshot is null
    ),
    'recent_sales',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'id',recent.id,'total',recent.total,'completed_at',recent.completed_at
      ) order by recent.completed_at desc),'[]'::jsonb)
      from (
        select id,total,completed_at
        from public.sales
        where tenant_id=p_tenant_id and status='completed'
          and completed_at>=p_from and completed_at<p_to
        order by completed_at desc limit 15
      ) recent
    ),
    'top_products',(
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_name',top.product_name,
        'quantity',top.quantity,
        'revenue',top.revenue,
        'cost',top.cost,
        'gross_margin',top.gross_margin,
        'costed_lines',top.costed_lines,
        'total_lines',top.total_lines
      ) order by top.gross_margin desc nulls last,top.revenue desc),'[]'::jsonb)
      from (
        select si.product_name,
          sum(si.quantity) as quantity,
          sum(si.line_subtotal) as revenue,
          sum(si.quantity*si.unit_cost_snapshot) filter (where si.unit_cost_snapshot is not null) as cost,
          sum(si.line_subtotal-(si.quantity*si.unit_cost_snapshot)) filter (where si.unit_cost_snapshot is not null) as gross_margin,
          count(*) filter (where si.unit_cost_snapshot is not null) as costed_lines,
          count(*) as total_lines
        from public.sale_items si
        join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id
        where si.tenant_id=p_tenant_id and parent.status='completed'
          and parent.completed_at>=p_from and parent.completed_at<p_to
        group by si.product_name
        order by sum(si.line_subtotal) desc
        limit 10
      ) top
    ),
    'expenses',(
      select coalesce(sum(e.amount),0) from public.expenses e
      where e.tenant_id=p_tenant_id and e.expense_date>=p_from::date and e.expense_date<p_to::date
    ),
    'returns_amount',(
      select coalesce(sum(sr.refund_total),0) from public.sale_returns sr
      where sr.tenant_id=p_tenant_id and sr.created_at>=p_from and sr.created_at<p_to
    ),
    'returns_count',(
      select count(*) from public.sale_returns sr
      where sr.tenant_id=p_tenant_id and sr.created_at>=p_from and sr.created_at<p_to
    ),
    'purchases',(
      select coalesce(sum(po.total_amount),0) from public.purchase_orders po
      where po.tenant_id=p_tenant_id and po.status<>'cancelled' and po.ordered_at>=p_from and po.ordered_at<p_to
    ),
    'cash_variance',(
      select coalesce(sum(cs.cash_variance),0) from public.cash_sessions cs
      where cs.tenant_id=p_tenant_id and cs.status='closed'
        and cs.closed_at>=p_from and cs.closed_at<p_to
    ),
    'stock_movements_count',(
      select count(*) from public.stock_movements sm
      where sm.tenant_id=p_tenant_id and sm.created_at>=p_from and sm.created_at<p_to
    )
  ) into v_result
  from public.sales s
  where s.tenant_id=p_tenant_id and s.status='completed'
    and s.completed_at>=p_from and s.completed_at<p_to;

  return v_result;
end;
$$;

revoke all on function public.get_tenant_management_report(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_tenant_management_report(uuid,timestamptz,timestamptz) to authenticated;
