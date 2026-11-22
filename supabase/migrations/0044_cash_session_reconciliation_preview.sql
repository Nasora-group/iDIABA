-- Live cash-session reconciliation preview, without changing or closing the session.
create or replace function public.get_cash_session_reconciliation(
  p_session_id uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session public.cash_sessions%rowtype;
  v_cash_sales numeric(14,2);
  v_cash_in numeric(14,2);
  v_cash_out numeric(14,2);
  v_payments jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  select * into v_session
  from public.cash_sessions
  where id = p_session_id;

  if not found or v_session.status <> 'open' then
    raise exception 'Session de caisse ouverte introuvable';
  end if;

  if not public.is_tenant_member(v_session.tenant_id) then
    raise exception 'Accès refusé à cette entreprise';
  end if;

  if v_session.opened_by <> auth.uid()
     and not public.has_tenant_role(
       v_session.tenant_id,
       array['owner','admin','manager']::public.tenant_role[]
     ) then
    raise exception 'Accès refusé à cette session de caisse';
  end if;

  select coalesce(sum(sp.amount), 0)::numeric(14,2)
  into v_cash_sales
  from public.sale_payments sp
  join public.sales s
    on s.id = sp.sale_id and s.tenant_id = sp.tenant_id
  where sp.tenant_id = v_session.tenant_id
    and s.cash_session_id = v_session.id
    and s.status = 'completed'
    and sp.payment_method = 'cash';

  select coalesce(sum(cm.amount), 0)::numeric(14,2)
  into v_cash_in
  from public.cash_movements cm
  where cm.tenant_id = v_session.tenant_id
    and cm.cash_session_id = v_session.id
    and cm.movement_type = 'cash_in';

  select coalesce(sum(cm.amount), 0)::numeric(14,2)
  into v_cash_out
  from public.cash_movements cm
  where cm.tenant_id = v_session.tenant_id
    and cm.cash_session_id = v_session.id
    and cm.movement_type = 'cash_out';

  select coalesce(jsonb_agg(jsonb_build_object(
    'payment_method', grouped.payment_method,
    'amount', grouped.amount,
    'payments_count', grouped.payments_count
  ) order by grouped.amount desc), '[]'::jsonb)
  into v_payments
  from (
    select sp.payment_method,
      sum(sp.amount)::numeric(14,2) as amount,
      count(sp.id) as payments_count
    from public.sale_payments sp
    join public.sales s
      on s.id = sp.sale_id and s.tenant_id = sp.tenant_id
    where sp.tenant_id = v_session.tenant_id
      and s.cash_session_id = v_session.id
      and s.status = 'completed'
    group by sp.payment_method
  ) grouped;

  return jsonb_build_object(
    'cash_sales', v_cash_sales,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'expected_cash', round(v_session.opening_cash + v_cash_sales + v_cash_in - v_cash_out, 2),
    'payments', v_payments
  );
end;
$$;

revoke all on function public.get_cash_session_reconciliation(uuid) from public, anon;
grant execute on function public.get_cash_session_reconciliation(uuid) to authenticated;
