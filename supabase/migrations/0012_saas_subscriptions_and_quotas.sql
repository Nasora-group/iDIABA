-- iDIABA Sprint 11: tenant subscriptions, configurable plans and server-enforced quotas.
create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  description text not null default '',
  price_monthly_fcfa numeric(14,2),
  price_yearly_fcfa numeric(14,2),
  max_users integer check (max_users is null or max_users > 0),
  max_locations integer check (max_locations is null or max_locations > 0),
  max_products integer check (max_products is null or max_products > 0),
  max_monthly_sales integer check (max_monthly_sales is null or max_monthly_sales > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.subscription_plans
  (code,name,description,price_monthly_fcfa,price_yearly_fcfa,max_users,max_locations,max_products,max_monthly_sales)
values
  ('trial','Essai gratuit','Découverte de toutes les fonctions essentielles pendant 14 jours.',0,0,2,1,100,200),
  ('starter','Essentiel','Pour démarrer avec une petite équipe.',null,null,3,2,500,2000),
  ('pro','Professionnel','Pour les commerces en croissance et les équipes multi-caissiers.',null,null,10,5,5000,10000),
  ('business','Business','Pour les entreprises avec plusieurs points de vente.',null,null,25,10,20000,50000),
  ('enterprise','Entreprise','Capacités configurables selon le contrat.',null,null,null,null,null,null)
on conflict (code) do update set
  name=excluded.name, description=excluded.description,
  max_users=excluded.max_users, max_locations=excluded.max_locations,
  max_products=excluded.max_products, max_monthly_sales=excluded.max_monthly_sales,
  updated_at=now();

create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status text not null default 'trialing'
    check (status in ('trialing','active','past_due','suspended','canceled','expired')),
  billing_interval text not null default 'monthly'
    check (billing_interval in ('monthly','yearly')),
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  grace_ends_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tenant_subscriptions_plan_status_idx
  on public.tenant_subscriptions(plan_id,status);

create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_plan_id uuid not null references public.subscription_plans(id),
  billing_interval text not null check (billing_interval in ('monthly','yearly')),
  payment_method text not null check (payment_method in ('wave','orange_money','bank_transfer','cash','other')),
  payment_reference text not null default '' check (length(payment_reference) <= 160),
  status text not null default 'pending' check (status in ('pending','approved','rejected','canceled')),
  created_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  unique (tenant_id,id)
);
create index if not exists subscription_requests_tenant_created_idx
  on public.subscription_requests(tenant_id,created_at desc);

alter table public.subscription_plans enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.subscription_requests enable row level security;

drop policy if exists "authenticated read active subscription plans" on public.subscription_plans;
create policy "authenticated read active subscription plans" on public.subscription_plans
  for select to authenticated using (is_active=true);
create policy "tenant owners read subscriptions" on public.tenant_subscriptions
  for select to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin']::public.tenant_role[]));
create policy "tenant owners read subscription requests" on public.subscription_requests
  for select to authenticated using (public.has_tenant_role(tenant_id,array['owner','admin']::public.tenant_role[]));

grant select on public.subscription_plans,public.tenant_subscriptions,public.subscription_requests to authenticated;

create or replace function public.create_trial_subscription()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare trial_plan_id uuid;
begin
  select id into trial_plan_id from public.subscription_plans where code='trial' and is_active=true;
  if trial_plan_id is null then raise exception 'Default trial plan is not configured'; end if;
  insert into public.tenant_subscriptions(tenant_id,plan_id,status,trial_ends_at,current_period_starts_at,current_period_ends_at)
  values(new.id,trial_plan_id,'trialing',now()+interval '14 days',now(),now()+interval '14 days')
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tenants_create_trial_subscription on public.tenants;
create trigger tenants_create_trial_subscription after insert on public.tenants
  for each row execute function public.create_trial_subscription();

-- Existing companies receive a fresh 14-day onboarding trial from migration time.
insert into public.tenant_subscriptions(tenant_id,plan_id,status,trial_ends_at,current_period_starts_at,current_period_ends_at)
select t.id,p.id,'trialing',now()+interval '14 days',now(),now()+interval '14 days'
from public.tenants t cross join public.subscription_plans p
where p.code='trial' and p.is_active=true
on conflict (tenant_id) do nothing;

create or replace function public.enforce_tenant_subscription_quota()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid;
  v_status text;
  v_trial_ends_at timestamptz;
  v_period_ends_at timestamptz;
  v_grace_ends_at timestamptz;
  v_plan public.subscription_plans%rowtype;
  v_count bigint;
  v_limit integer;
  v_lock_key text;
begin
  if tg_table_name='products' then
    if new.is_active is distinct from true then return new; end if;
  elsif tg_table_name='stock_locations' then
    if new.is_active is distinct from true then return new; end if;
  end if;
  v_tenant_id := new.tenant_id;
  v_lock_key := v_tenant_id::text || ':' || tg_table_name;
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key,0));

  select s.status,s.trial_ends_at,s.current_period_ends_at,s.grace_ends_at,p
    into v_status,v_trial_ends_at,v_period_ends_at,v_grace_ends_at,v_plan
  from public.tenant_subscriptions s
  join public.subscription_plans p on p.id=s.plan_id
  where s.tenant_id=v_tenant_id and p.is_active=true
  for update of s;

  if not found then raise exception 'Aucune souscription active pour cette entreprise'; end if;

  if v_status not in ('trialing','active','past_due') then
    raise exception 'Abonnement expiré ou suspendu. Choisissez une formule pour continuer.';
  end if;
  if v_status='trialing' and (v_trial_ends_at is null or v_trial_ends_at <= now()) then
    raise exception 'Période d''essai terminée. Choisissez une formule pour continuer.';
  end if;
  if v_status='active' and v_period_ends_at is not null and v_period_ends_at <= now() then
    raise exception 'Abonnement arrivé à échéance. Renouvelez votre formule.';
  end if;
  if v_status='past_due' and (v_grace_ends_at is null or v_grace_ends_at <= now()) then
    raise exception 'Délai de paiement dépassé. Contactez le support.';
  end if;

  if tg_table_name='products' then
    v_limit := v_plan.max_products;
    if v_limit is not null then
      select count(*) into v_count from public.products where tenant_id=v_tenant_id and is_active=true;
      if v_count >= v_limit then raise exception 'Limite de produits atteinte (%). Passez à une formule supérieure.',v_limit; end if;
    end if;
  elsif tg_table_name='stock_locations' then
    v_limit := v_plan.max_locations;
    if v_limit is not null then
      select count(*) into v_count from public.stock_locations where tenant_id=v_tenant_id and is_active=true;
      if v_count >= v_limit then raise exception 'Limite de dépôts atteinte (%). Passez à une formule supérieure.',v_limit; end if;
    end if;
  elsif tg_table_name='tenant_memberships' then
    v_limit := v_plan.max_users;
    if v_limit is not null then
      select count(*) into v_count from public.tenant_memberships where tenant_id=v_tenant_id;
      if v_count >= v_limit then raise exception 'Limite d''utilisateurs atteinte (%). Passez à une formule supérieure.',v_limit; end if;
    end if;
  elsif tg_table_name='sales' then
    v_limit := v_plan.max_monthly_sales;
    if v_limit is not null then
      select count(*) into v_count from public.sales
      where tenant_id=v_tenant_id and status='completed'
        and created_at >= date_trunc('month',now())
        and created_at < date_trunc('month',now()) + interval '1 month';
      if v_count >= v_limit then raise exception 'Limite de ventes mensuelles atteinte (%). Passez à une formule supérieure.',v_limit; end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists products_subscription_quota on public.products;
create trigger products_subscription_quota before insert on public.products
  for each row execute function public.enforce_tenant_subscription_quota();
drop trigger if exists stock_locations_subscription_quota on public.stock_locations;
create trigger stock_locations_subscription_quota before insert on public.stock_locations
  for each row execute function public.enforce_tenant_subscription_quota();
drop trigger if exists tenant_memberships_subscription_quota on public.tenant_memberships;
create trigger tenant_memberships_subscription_quota before insert on public.tenant_memberships
  for each row execute function public.enforce_tenant_subscription_quota();
drop trigger if exists sales_subscription_quota on public.sales;
create trigger sales_subscription_quota before insert on public.sales
  for each row execute function public.enforce_tenant_subscription_quota();

create or replace function public.request_subscription_change(
  p_tenant_id uuid,
  p_plan_code text,
  p_billing_interval text,
  p_payment_method text,
  p_payment_reference text default ''
) returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_plan_id uuid;
  v_request_id uuid;
begin
  if auth.uid() is null or not public.has_tenant_role(p_tenant_id,array['owner','admin']::public.tenant_role[]) then
    raise exception 'Seul un propriétaire ou administrateur peut demander un changement de formule';
  end if;
  if p_billing_interval not in ('monthly','yearly') then raise exception 'Période de facturation invalide'; end if;
  if p_payment_method not in ('wave','orange_money','bank_transfer','cash','other') then raise exception 'Moyen de paiement invalide'; end if;
  if length(coalesce(p_payment_reference,'')) > 160 then raise exception 'Référence de paiement trop longue'; end if;
  select id into v_plan_id from public.subscription_plans where code=p_plan_code and is_active=true and code<>'trial';
  if v_plan_id is null then raise exception 'Formule indisponible'; end if;
  if exists(select 1 from public.subscription_requests where tenant_id=p_tenant_id and status='pending') then
    raise exception 'Une demande de changement est déjà en attente';
  end if;
  insert into public.subscription_requests(tenant_id,requested_plan_id,billing_interval,payment_method,payment_reference,created_by)
  values(p_tenant_id,v_plan_id,p_billing_interval,p_payment_method,coalesce(p_payment_reference,''),auth.uid())
  returning id into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.create_trial_subscription() from public,anon,authenticated;
revoke all on function public.enforce_tenant_subscription_quota() from public,anon,authenticated;
revoke all on function public.request_subscription_change(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.request_subscription_change(uuid,text,text,text,text) to authenticated;
