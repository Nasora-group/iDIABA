-- Align report, accounting setup and stock movement trigger with granular permissions.

CREATE OR REPLACE FUNCTION public.ensure_accounting_chart(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
 if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'accounting_manage') then
  raise exception 'Permission denied';
 end if;
 perform public.seed_default_accounting_chart(p_tenant_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.get_tenant_management_report(p_tenant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'reports_read') then
    raise exception 'Accès réservé aux propriétaires et administrateurs';
  end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '366 days' then
    raise exception 'Période de rapport invalide (maximum 366 jours)';
  end if;
  select jsonb_build_object(
    'revenue',coalesce(sum(s.total),0),
    'sales_count',count(s.id),
    'average_ticket',coalesce(avg(s.total),0),
    'costed_revenue',coalesce((select sum(si.line_subtotal) from public.sale_items si join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id where si.tenant_id=p_tenant_id and parent.status='completed' and parent.completed_at>=p_from and parent.completed_at<p_to and si.unit_cost_snapshot is not null),0),
    'cost_of_goods_sold',coalesce((select sum(si.quantity*si.unit_cost_snapshot) from public.sale_items si join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id where si.tenant_id=p_tenant_id and parent.status='completed' and parent.completed_at>=p_from and parent.completed_at<p_to and si.unit_cost_snapshot is not null),0),
    'gross_margin',coalesce((select sum(si.line_subtotal-(si.quantity*si.unit_cost_snapshot)) from public.sale_items si join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id where si.tenant_id=p_tenant_id and parent.status='completed' and parent.completed_at>=p_from and parent.completed_at<p_to and si.unit_cost_snapshot is not null),0),
    'gross_margin_rate',coalesce((select case when sum(si.line_subtotal)>0 then round(100*sum(si.line_subtotal-(si.quantity*si.unit_cost_snapshot))/sum(si.line_subtotal),2) else 0 end from public.sale_items si join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id where si.tenant_id=p_tenant_id and parent.status='completed' and parent.completed_at>=p_from and parent.completed_at<p_to and si.unit_cost_snapshot is not null),0),
    'costed_lines',(select count(*) from public.sale_items si join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id where si.tenant_id=p_tenant_id and parent.status='completed' and parent.completed_at>=p_from and parent.completed_at<p_to and si.unit_cost_snapshot is not null),
    'uncosted_lines',(select count(*) from public.sale_items si join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id where si.tenant_id=p_tenant_id and parent.status='completed' and parent.completed_at>=p_from and parent.completed_at<p_to and si.unit_cost_snapshot is null),
    'recent_sales',(select coalesce(jsonb_agg(jsonb_build_object('id',recent.id,'total',recent.total,'completed_at',recent.completed_at) order by recent.completed_at desc),'[]'::jsonb) from (select id,total,completed_at from public.sales where tenant_id=p_tenant_id and status='completed' and completed_at>=p_from and completed_at<p_to order by completed_at desc limit 15) recent),
    'top_products',(select coalesce(jsonb_agg(jsonb_build_object('product_name',top.product_name,'quantity',top.quantity,'revenue',top.revenue,'cost',top.cost,'gross_margin',top.gross_margin,'costed_lines',top.costed_lines,'total_lines',top.total_lines) order by top.gross_margin desc nulls last,top.revenue desc),'[]'::jsonb) from (select si.product_name,sum(si.quantity) as quantity,sum(si.line_subtotal) as revenue,sum(si.quantity*si.unit_cost_snapshot) filter (where si.unit_cost_snapshot is not null) as cost,sum(si.line_subtotal-(si.quantity*si.unit_cost_snapshot)) filter (where si.unit_cost_snapshot is not null) as gross_margin,count(*) filter (where si.unit_cost_snapshot is not null) as costed_lines,count(*) as total_lines from public.sale_items si join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id where si.tenant_id=p_tenant_id and parent.status='completed' and parent.completed_at>=p_from and parent.completed_at<p_to group by si.product_name order by sum(si.line_subtotal) desc limit 10) top),
    'expenses',(select coalesce(sum(e.amount),0) from public.expenses e where e.tenant_id=p_tenant_id and e.expense_date>=p_from::date and e.expense_date<p_to::date),
    'returns_amount',(select coalesce(sum(sr.refund_total),0) from public.sale_returns sr where sr.tenant_id=p_tenant_id and sr.created_at>=p_from and sr.created_at<p_to),
    'returns_count',(select count(*) from public.sale_returns sr where sr.tenant_id=p_tenant_id and sr.created_at>=p_from and sr.created_at<p_to),
    'purchases',(select coalesce(sum(po.total_amount),0) from public.purchase_orders po where po.tenant_id=p_tenant_id and po.status<>'cancelled' and po.ordered_at>=p_from and po.ordered_at<p_to),
    'cash_variance',(select coalesce(sum(cs.cash_variance),0) from public.cash_sessions cs where cs.tenant_id=p_tenant_id and cs.status='closed' and cs.closed_at>=p_from and cs.closed_at<p_to),
    'stock_movements_count',(select count(*) from public.stock_movements sm where sm.tenant_id=p_tenant_id and sm.created_at>=p_from and sm.created_at<p_to)
  ) into v_result
  from public.sales s
  where s.tenant_id=p_tenant_id and s.status='completed' and s.completed_at>=p_from and s.completed_at<p_to;
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_tenant_payment_method_report(p_tenant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null
     or not private.has_tenant_permission(p_tenant_id,'reports_read') then
    raise exception 'Accès réservé aux propriétaires et administrateurs';
  end if;
  if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval '366 days' then
    raise exception 'Période de rapport invalide (maximum 366 jours)';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'payment_method', grouped.payment_method,
    'amount', grouped.amount,
    'payments_count', grouped.payments_count,
    'sales_count', grouped.sales_count
  ) order by grouped.amount desc), '[]'::jsonb)
  into v_result
  from (
    select sp.payment_method,
      sum(sp.amount)::numeric(14,2) as amount,
      count(sp.id) as payments_count,
      count(distinct s.id) as sales_count
    from public.sale_payments sp
    join public.sales s on s.id=sp.sale_id and s.tenant_id=sp.tenant_id
    where sp.tenant_id=p_tenant_id and s.status='completed'
      and s.completed_at>=p_from and s.completed_at<p_to
    group by sp.payment_method
  ) grouped;
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_tenant_sales_trend(p_tenant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null
     or not private.has_tenant_permission(p_tenant_id,'reports_read') then
    raise exception 'Accès réservé aux propriétaires et administrateurs';
  end if;
  if p_from is null or p_to is null or p_to <= p_from
     or p_to - p_from > interval '366 days' then
    raise exception 'Période de rapport invalide (maximum 366 jours)';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'day', days.day::date,
    'revenue', coalesce(sales.revenue,0),
    'sales_count', coalesce(sales.sales_count,0)
  ) order by days.day), '[]'::jsonb)
  into v_result
  from generate_series(
    date_trunc('day',p_from),
    date_trunc('day',p_to - interval '1 millisecond'),
    interval '1 day'
  ) as days(day)
  left join (
    select date_trunc('day',completed_at) as day,
      sum(total) as revenue,
      count(*) as sales_count
    from public.sales
    where tenant_id=p_tenant_id and status='completed'
      and completed_at>=p_from and completed_at<p_to
    group by date_trunc('day',completed_at)
  ) sales on sales.day=days.day;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare current_quantity numeric(14,3);
begin
  if new.movement_type in ('sale','sale_return') then
    if not private.has_tenant_permission(new.tenant_id,'cash_register') then
      raise exception 'Insufficient permissions for sale stock movements';
    end if;
  elsif not private.has_tenant_permission(new.tenant_id,'stock_manage') then
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
$function$
;
