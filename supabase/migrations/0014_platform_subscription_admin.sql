-- Sprint 13: platform administration for subscription plans and payment approval.
drop policy if exists "authenticated read active subscription plans" on public.subscription_plans;
create policy "authenticated read active subscription plans" on public.subscription_plans
  for select to authenticated
  using (
    is_active=true
    or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin'
  );

create policy "platform admins update subscription plans" on public.subscription_plans
  for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin');
grant update on public.subscription_plans to authenticated;

create policy "platform admins read all tenant subscriptions" on public.tenant_subscriptions
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin');

create policy "platform admins read all subscription requests" on public.subscription_requests
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin');

create or replace function public.review_subscription_request(
  p_request_id uuid,
  p_decision text,
  p_admin_note text default ''
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid;
  v_plan_id uuid;
  v_billing_interval text;
  v_price numeric(14,2);
  v_note text := coalesce(p_admin_note,'');
begin
  if auth.uid() is null
     or coalesce((auth.jwt() -> 'app_metadata' ->> 'role'),'') <> 'platform_admin' then
    raise exception 'Accès réservé à l''administration iDIABA';
  end if;
  if p_decision not in ('approve','reject') then
    raise exception 'Décision invalide';
  end if;
  if length(v_note)>500 then raise exception 'Note administrative trop longue'; end if;

  select tenant_id,requested_plan_id,billing_interval
    into v_tenant_id,v_plan_id,v_billing_interval
  from public.subscription_requests
  where id=p_request_id and status='pending'
  for update;

  if not found then raise exception 'Demande introuvable ou déjà traitée'; end if;

  if p_decision='approve' then
    select case when v_billing_interval='monthly' then price_monthly_fcfa else price_yearly_fcfa end
      into v_price
    from public.subscription_plans
    where id=v_plan_id and is_active=true;
    if v_price is null then
      raise exception 'Configurez le tarif de cette formule avant de valider la demande';
    end if;

    insert into public.tenant_subscriptions(
      tenant_id,plan_id,status,billing_interval,trial_ends_at,
      current_period_starts_at,current_period_ends_at,grace_ends_at,canceled_at,updated_at
    ) values (
      v_tenant_id,v_plan_id,'active',v_billing_interval,null,
      now(),
      case when v_billing_interval='monthly' then now()+interval '1 month' else now()+interval '1 year' end,
      null,null,now()
    )
    on conflict (tenant_id) do update set
      plan_id=excluded.plan_id,
      status='active',
      billing_interval=excluded.billing_interval,
      trial_ends_at=null,
      current_period_starts_at=excluded.current_period_starts_at,
      current_period_ends_at=excluded.current_period_ends_at,
      grace_ends_at=null,
      canceled_at=null,
      updated_at=now();

    update public.subscription_requests
      set status='approved',reviewed_by=auth.uid(),reviewed_at=now(),admin_note=v_note
      where id=p_request_id;
  else
    update public.subscription_requests
      set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),admin_note=v_note
      where id=p_request_id;
  end if;
end;
$$;

revoke all on function public.review_subscription_request(uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_subscription_request(uuid,text,text) to authenticated;
