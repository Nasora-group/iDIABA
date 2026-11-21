-- iDIABA Sprint 6: controlled cash-in/out movements and cash reconciliation.
-- Cash movements are append-only; expected cash is calculated server-side at session close.
create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  cash_session_id uuid not null,
  movement_type text not null check (movement_type in ('cash_in','cash_out')),
  amount numeric(14,2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) between 2 and 250),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint cash_movements_session_tenant_fk foreign key (tenant_id, cash_session_id)
    references public.cash_sessions(tenant_id, id)
);
create index if not exists cash_movements_tenant_session_date_idx
  on public.cash_movements(tenant_id, cash_session_id, created_at desc);

alter table public.cash_movements enable row level security;
create policy "members read cash movements" on public.cash_movements
  for select to authenticated using (public.is_tenant_member(tenant_id));
grant select on public.cash_movements to authenticated;

create or replace function public.prevent_cash_movement_mutation()
returns trigger language plpgsql
as $$
begin
  raise exception 'Cash movements are immutable. Record a correcting movement instead.';
end;
$$;
drop trigger if exists cash_movements_immutable on public.cash_movements;
create trigger cash_movements_immutable
  before update or delete on public.cash_movements
  for each row execute function public.prevent_cash_movement_mutation();

create or replace function public.create_cash_movement(
  p_session_id uuid,
  p_movement_type text,
  p_amount numeric,
  p_reason text
) returns uuid language plpgsql security definer set search_path = public
as $$
declare
  s public.cash_sessions%rowtype;
  current_cash numeric(14,2);
  new_movement_id uuid;
begin
  if auth.uid() is null
     or p_movement_type not in ('cash_in','cash_out')
     or p_amount is null or p_amount <= 0
     or length(trim(coalesce(p_reason,''))) < 2
     or length(trim(p_reason)) > 250 then
    raise exception 'Invalid cash movement';
  end if;

  select * into s from public.cash_sessions where id=p_session_id for update;
  if not found or s.status <> 'open' then
    raise exception 'Cash session is not open';
  end if;
  if not public.has_tenant_role(s.tenant_id,array['owner','admin','manager','cashier']::public.tenant_role[]) then
    raise exception 'Permission denied to record cash movement';
  end if;
  if s.opened_by <> auth.uid()
     and not public.has_tenant_role(s.tenant_id,array['owner','admin','manager']::public.tenant_role[]) then
    raise exception 'This cash session belongs to another cashier';
  end if;

  select round(
    s.opening_cash
    + coalesce((select sum(sp.amount) from public.sale_payments sp
        join public.sales sa on sa.id=sp.sale_id and sa.tenant_id=sp.tenant_id
        where sp.tenant_id=s.tenant_id and sa.cash_session_id=s.id
          and sa.status='completed' and sp.payment_method='cash'),0)
    + coalesce((select sum(cm.amount) from public.cash_movements cm
        where cm.tenant_id=s.tenant_id and cm.cash_session_id=s.id and cm.movement_type='cash_in'),0)
    - coalesce((select sum(cm.amount) from public.cash_movements cm
        where cm.tenant_id=s.tenant_id and cm.cash_session_id=s.id and cm.movement_type='cash_out'),0)
  ,2) into current_cash;
  if p_movement_type='cash_out' and round(p_amount,2) > current_cash then
    raise exception 'Cash-out exceeds available cash balance: %', current_cash;
  end if;

  insert into public.cash_movements(tenant_id,cash_session_id,movement_type,amount,reason,created_by)
    values(s.tenant_id,s.id,p_movement_type,round(p_amount,2),trim(p_reason),auth.uid())
    returning id into new_movement_id;
  return new_movement_id;
end;
$$;

-- Replace the close routine so the expected balance includes cash sales, cash-in and cash-out.
create or replace function public.close_cash_session(
  p_session_id uuid, p_closing_cash numeric
) returns void language plpgsql security definer set search_path = public
as $$
declare
  s public.cash_sessions%rowtype;
  expected numeric(14,2);
begin
  if auth.uid() is null or p_closing_cash is null or p_closing_cash < 0 then
    raise exception 'Invalid closing cash';
  end if;
  select * into s from public.cash_sessions where id=p_session_id for update;
  if not found or s.status <> 'open' then raise exception 'Cash session is not open'; end if;
  if s.opened_by <> auth.uid()
     and not public.has_tenant_role(s.tenant_id,array['owner','admin','manager']::public.tenant_role[]) then
    raise exception 'Permission denied to close this cash session';
  end if;

  select round(
    s.opening_cash
    + coalesce((select sum(sp.amount)
        from public.sale_payments sp
        join public.sales sa on sa.id=sp.sale_id and sa.tenant_id=sp.tenant_id
        where sp.tenant_id=s.tenant_id and sa.cash_session_id=s.id
          and sa.status='completed' and sp.payment_method='cash'),0)
    + coalesce((select sum(cm.amount) from public.cash_movements cm
        where cm.tenant_id=s.tenant_id and cm.cash_session_id=s.id and cm.movement_type='cash_in'),0)
    - coalesce((select sum(cm.amount) from public.cash_movements cm
        where cm.tenant_id=s.tenant_id and cm.cash_session_id=s.id and cm.movement_type='cash_out'),0)
  ,2) into expected;

  update public.cash_sessions set status='closed', closed_by=auth.uid(), closed_at=now(),
    expected_cash=expected, closing_cash=round(p_closing_cash,2),
    cash_variance=round(p_closing_cash-expected,2)
    where id=s.id;
end;
$$;

revoke all on function public.create_cash_movement(uuid,text,numeric,text) from public;
grant execute on function public.create_cash_movement(uuid,text,numeric,text) to authenticated;
revoke all on function public.close_cash_session(uuid,numeric) from public;
grant execute on function public.close_cash_session(uuid,numeric) to authenticated;
