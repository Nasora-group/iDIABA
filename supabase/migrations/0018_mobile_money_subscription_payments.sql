-- iDIABA Sprint 17: subscription payment intents and verified Wave webhook processing.
create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_request_id uuid not null,
  provider text not null check (provider in ('wave','orange_money')),
  amount_fcfa bigint not null check (amount_fcfa > 0),
  currency text not null default 'XOF' check (currency = 'XOF'),
  status text not null default 'pending'
    check (status in ('pending','processing','paid','failed','expired','manual_review')),
  idempotency_key uuid not null unique,
  provider_reference text,
  checkout_url text,
  provider_transaction_id text,
  failure_reason text not null default '',
  created_by uuid not null references auth.users(id),
  paid_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,subscription_request_id)
    references public.subscription_requests(tenant_id,id) on delete cascade
);
create unique index if not exists subscription_payments_provider_reference_uidx
  on public.subscription_payments(provider,provider_reference)
  where provider_reference is not null;
create index if not exists subscription_payments_tenant_created_idx
  on public.subscription_payments(tenant_id,created_at desc);
create index if not exists subscription_payments_request_created_idx
  on public.subscription_payments(subscription_request_id,created_at desc);

alter table public.subscription_payments enable row level security;
create policy "tenant owners read subscription payments" on public.subscription_payments
  for select to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin']::public.tenant_role[]));
grant select on public.subscription_payments to authenticated;

create table if not exists public.payment_webhook_events (
  provider text not null check (provider in ('wave','orange_money')),
  event_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  primary key(provider,event_id)
);
alter table public.payment_webhook_events enable row level security;
revoke all on public.payment_webhook_events from public,anon,authenticated;

create or replace function public.create_subscription_payment(
  p_tenant_id uuid,
  p_plan_code text,
  p_billing_interval text,
  p_provider text,
  p_idempotency_key uuid
) returns table(payment_id uuid, amount_fcfa bigint)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
  v_price numeric(14,2);
  v_request_id uuid;
  v_payment_id uuid;
  v_amount bigint;
begin
  if v_user_id is null then raise exception 'Authentification requise'; end if;
  if not public.has_tenant_role(p_tenant_id,array['owner','admin']::public.tenant_role[]) then
    raise exception 'Accès réservé au propriétaire ou administrateur de l’entreprise';
  end if;
  if p_provider <> 'wave' then raise exception 'Paiement en ligne Wave uniquement; Orange Money reste en validation manuelle'; end if;
  if p_billing_interval not in ('monthly','yearly') then raise exception 'Période de facturation invalide'; end if;
  if p_plan_code not in ('starter','pro','business','enterprise') then raise exception 'Formule invalide'; end if;
  if p_idempotency_key is null then raise exception 'Clé idempotence requise'; end if;

  select id,case when p_billing_interval='monthly' then price_monthly_fcfa else price_yearly_fcfa end
    into v_plan_id,v_price
  from public.subscription_plans
  where code=p_plan_code and is_active=true;
  if v_plan_id is null or v_price is null or v_price<=0 or v_price<>trunc(v_price) then
    raise exception 'Le tarif de cette formule doit être configuré en FCFA entiers';
  end if;
  v_amount := v_price::bigint;

  select id into v_payment_id from public.subscription_payments where idempotency_key=p_idempotency_key and tenant_id=p_tenant_id;
  if v_payment_id is not null then
    return query select sp.id,sp.amount_fcfa from public.subscription_payments sp where sp.id=v_payment_id;
    return;
  end if;

  select id into v_request_id from public.subscription_requests
   where tenant_id=p_tenant_id and status='pending' for update;
  if v_request_id is not null then
    if not exists (
      select 1 from public.subscription_requests r
      where r.id=v_request_id and r.requested_plan_id=v_plan_id
        and r.billing_interval=p_billing_interval and r.payment_method='wave'
    ) then
      raise exception 'Une demande de souscription est déjà en attente. Terminez-la avant d’en créer une autre.';
    end if;
  else
    insert into public.subscription_requests(
      tenant_id,requested_plan_id,billing_interval,payment_method,payment_reference,created_by
    ) values(p_tenant_id,v_plan_id,p_billing_interval,'wave','',v_user_id)
    returning id into v_request_id;
  end if;

  select id into v_payment_id from public.subscription_payments
   where subscription_request_id=v_request_id and provider='wave'
     and status in ('pending','processing') and expires_at>now()
   order by created_at desc limit 1;
  if v_payment_id is not null then
    return query select sp.id,sp.amount_fcfa from public.subscription_payments sp where sp.id=v_payment_id;
    return;
  end if;

  insert into public.subscription_payments(
    tenant_id,subscription_request_id,provider,amount_fcfa,idempotency_key,created_by
  ) values(p_tenant_id,v_request_id,'wave',v_amount,p_idempotency_key,v_user_id)
  returning id into v_payment_id;

  return query select v_payment_id,v_amount;
end;
$$;

create or replace function public.attach_subscription_payment_checkout(
  p_payment_id uuid,
  p_provider_reference text,
  p_checkout_url text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_provider_reference is null or length(p_provider_reference)>120 then raise exception 'Référence prestataire invalide'; end if;
  if p_checkout_url is null or p_checkout_url !~ '^https://pay\.wave\.com/' then raise exception 'Adresse de paiement Wave invalide'; end if;
  select tenant_id into v_tenant_id from public.subscription_payments
    where id=p_payment_id and provider='wave' and status='pending' for update;
  if v_tenant_id is null then raise exception 'Paiement introuvable ou déjà traité'; end if;
  if not public.has_tenant_role(v_tenant_id,array['owner','admin']::public.tenant_role[]) then
    raise exception 'Accès refusé';
  end if;
  update public.subscription_payments
    set provider_reference=p_provider_reference,checkout_url=p_checkout_url,
        status='processing',updated_at=now()
    where id=p_payment_id;
end;
$$;

create or replace function public.process_subscription_payment_webhook(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_provider_reference text,
  p_provider_transaction_id text,
  p_client_reference text,
  p_amount_fcfa bigint,
  p_currency text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_request public.subscription_requests%rowtype;
  v_plan_price numeric(14,2);
  v_inserted integer;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'Traitement webhook réservé au service de paiement';
  end if;
  if p_provider not in ('wave','orange_money') or p_event_id is null or length(p_event_id)>160 then
    raise exception 'Événement de paiement invalide';
  end if;
  if p_event_type not in ('checkout.session.completed','checkout.session.payment_failed','payment.success','payment.failed') then
    return 'ignored';
  end if;

  insert into public.payment_webhook_events(provider,event_id,event_type)
  values(p_provider,p_event_id,p_event_type)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then return 'duplicate'; end if;

  select * into v_payment from public.subscription_payments
   where provider=p_provider and provider_reference=p_provider_reference
   for update;
  if not found and p_client_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select * into v_payment from public.subscription_payments
     where provider=p_provider and id::text=p_client_reference
     for update;
    if found and v_payment.provider_reference is null then
      update public.subscription_payments
        set provider_reference=p_provider_reference,updated_at=now()
        where id=v_payment.id;
      v_payment.provider_reference := p_provider_reference;
    end if;
  end if;
  if not found then
    delete from public.payment_webhook_events where provider=p_provider and event_id=p_event_id;
    raise exception 'Paiement correspondant introuvable';
  end if;
  if v_payment.status='paid' then return 'already_paid'; end if;
  if v_payment.status not in ('pending','processing') then return 'not_payable'; end if;

  if p_event_type in ('checkout.session.completed','payment.success') then
    if p_amount_fcfa is distinct from v_payment.amount_fcfa or p_currency is distinct from 'XOF' then
      raise exception 'Montant ou devise du paiement non conforme';
    end if;
    select * into v_request from public.subscription_requests
      where id=v_payment.subscription_request_id and tenant_id=v_payment.tenant_id and status='pending'
      for update;
    if not found then raise exception 'Demande de souscription introuvable'; end if;
    select case when v_request.billing_interval='monthly' then price_monthly_fcfa else price_yearly_fcfa end
      into v_plan_price from public.subscription_plans
      where id=v_request.requested_plan_id and is_active=true;
    if v_plan_price is null or v_plan_price<>v_payment.amount_fcfa then
      raise exception 'Le tarif de la souscription a changé; contrôle administratif requis';
    end if;

    update public.subscription_payments
      set status='paid',provider_transaction_id=coalesce(p_provider_transaction_id,''),
          paid_at=now(),updated_at=now()
      where id=v_payment.id;

    insert into public.tenant_subscriptions(
      tenant_id,plan_id,status,billing_interval,trial_ends_at,
      current_period_starts_at,current_period_ends_at,grace_ends_at,canceled_at,updated_at
    ) values(
      v_payment.tenant_id,v_request.requested_plan_id,'active',v_request.billing_interval,null,
      now(),
      case when v_request.billing_interval='monthly' then now()+interval '1 month' else now()+interval '1 year' end,
      null,null,now()
    )
    on conflict(tenant_id) do update set
      plan_id=excluded.plan_id,status='active',billing_interval=excluded.billing_interval,
      trial_ends_at=null,current_period_starts_at=excluded.current_period_starts_at,
      current_period_ends_at=excluded.current_period_ends_at,grace_ends_at=null,
      canceled_at=null,updated_at=now();

    update public.subscription_requests
      set status='approved',reviewed_at=now(),
          admin_note='Paiement confirmé automatiquement par le prestataire.'
      where id=v_request.id;
    return 'paid';
  end if;

  -- Wave may report several failed attempts before a later successful payment
  -- on the same checkout session. Keep the intent payable until success or expiry.
  update public.subscription_payments
    set status='processing',failure_reason='Dernière tentative refusée par le prestataire',updated_at=now()
    where id=v_payment.id;
  return 'payment_failed_retryable';
end;
$$;

revoke all on function public.create_subscription_payment(uuid,text,text,text,uuid) from public,anon;
grant execute on function public.create_subscription_payment(uuid,text,text,text,uuid) to authenticated;
revoke all on function public.attach_subscription_payment_checkout(uuid,text,text) from public,anon;
grant execute on function public.attach_subscription_payment_checkout(uuid,text,text) to authenticated;
revoke all on function public.process_subscription_payment_webhook(text,text,text,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.process_subscription_payment_webhook(text,text,text,text,text,text,bigint,text) to service_role;

-- Include subscription payment changes in the existing tenant audit trail.
drop trigger if exists tenant_audit_log on public.subscription_payments;
create trigger tenant_audit_log after insert or update or delete on public.subscription_payments
  for each row execute function public.capture_tenant_audit_log();


-- Prevent manual activation of a Wave request before a verified webhook marks it paid.
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
  v_payment_method text;
  v_payment_reference text;
  v_price numeric(14,2);
  v_note text := coalesce(p_admin_note,'');
begin
  if auth.uid() is null
     or coalesce((auth.jwt() -> 'app_metadata' ->> 'role'),'') <> 'platform_admin' then
    raise exception 'Accès réservé à l''administration iDIABA';
  end if;
  if p_decision is null or p_decision not in ('approve','reject') then
    raise exception 'Décision invalide';
  end if;
  if length(v_note)>500 then raise exception 'Note administrative trop longue'; end if;

  select tenant_id,requested_plan_id,billing_interval,payment_method,payment_reference
    into v_tenant_id,v_plan_id,v_billing_interval,v_payment_method,v_payment_reference
  from public.subscription_requests
  where id=p_request_id and status='pending'
  for update;
  if not found then raise exception 'Demande introuvable ou déjà traitée'; end if;

  if p_decision='approve' then
    if v_payment_method='orange_money' and length(trim(coalesce(v_payment_reference,'')))=0 then
      raise exception 'La référence Orange Money est obligatoire avant validation';
    end if;
    if v_payment_method='wave' and not exists (
      select 1 from public.subscription_payments
      where subscription_request_id=p_request_id and status='paid'
    ) then
      raise exception 'Le paiement Wave doit être confirmé par le webhook avant activation';
    end if;

    select case when v_billing_interval='monthly' then price_monthly_fcfa else price_yearly_fcfa end
      into v_price from public.subscription_plans
      where id=v_plan_id and is_active=true;
    if v_price is null then
      raise exception 'Configurez le tarif de cette formule avant de valider la demande';
    end if;

    insert into public.tenant_subscriptions(
      tenant_id,plan_id,status,billing_interval,trial_ends_at,
      current_period_starts_at,current_period_ends_at,grace_ends_at,canceled_at,updated_at
    ) values (
      v_tenant_id,v_plan_id,'active',v_billing_interval,null,now(),
      case when v_billing_interval='monthly' then now()+interval '1 month' else now()+interval '1 year' end,
      null,null,now()
    )
    on conflict (tenant_id) do update set
      plan_id=excluded.plan_id,status='active',billing_interval=excluded.billing_interval,
      trial_ends_at=null,current_period_starts_at=excluded.current_period_starts_at,
      current_period_ends_at=excluded.current_period_ends_at,grace_ends_at=null,
      canceled_at=null,updated_at=now();

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

create policy "platform admins read all subscription payments" on public.subscription_payments
  for select to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'platform_admin');
