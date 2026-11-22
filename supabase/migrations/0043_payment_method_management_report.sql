-- Management report: collected payments grouped by payment method.
create or replace function public.get_tenant_payment_method_report(
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
$$;

revoke all on function public.get_tenant_payment_method_report(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_tenant_payment_method_report(uuid,timestamptz,timestamptz) to authenticated;
