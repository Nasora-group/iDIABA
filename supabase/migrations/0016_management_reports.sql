-- Sprint 15: tenant-scoped management report RPC and reporting indexes.
create index if not exists sales_tenant_completed_at_idx
  on public.sales(tenant_id,completed_at desc);
create index if not exists sale_items_tenant_sale_idx
  on public.sale_items(tenant_id,sale_id);
create index if not exists expenses_tenant_date_idx
  on public.expenses(tenant_id,expense_date desc);
create index if not exists purchase_orders_tenant_ordered_idx
  on public.purchase_orders(tenant_id,ordered_at desc);
create index if not exists cash_sessions_tenant_closed_idx
  on public.cash_sessions(tenant_id,closed_at desc);
create index if not exists stock_movements_tenant_created_idx
  on public.stock_movements(tenant_id,created_at desc);

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
        'product_name',top.product_name,'quantity',top.quantity,'revenue',top.revenue
      ) order by top.revenue desc),'[]'::jsonb)
      from (
        select si.product_name,sum(si.quantity) as quantity,sum(si.line_total) as revenue
        from public.sale_items si
        join public.sales parent on parent.id=si.sale_id and parent.tenant_id=si.tenant_id
        where si.tenant_id=p_tenant_id and parent.status='completed'
          and parent.completed_at>=p_from and parent.completed_at<p_to
        group by si.product_name
        order by sum(si.line_total) desc
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
