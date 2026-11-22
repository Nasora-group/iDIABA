-- Daily sales trend for tenant management reports.
-- Read-only RPC: tenant-scoped and restricted to owners/admins.
create or replace function public.get_tenant_sales_trend(
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
$$;

revoke all on function public.get_tenant_sales_trend(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_tenant_sales_trend(uuid,timestamptz,timestamptz) to authenticated;
