-- Universal stock traceability: lots, expiry dates and FEFO consumption.
-- Additive migration. Existing stock ledger and sales history are preserved.
alter table public.products
  add column if not exists track_lots boolean not null default false;
alter table public.stock_movements add column if not exists lot_id uuid;

create table if not exists public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null, location_id uuid not null,
  lot_code text not null check (length(trim(lot_code)) between 1 and 80),
  expiry_date date not null, received_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id), unique (tenant_id,product_id,location_id,lot_code),
  foreign key (tenant_id,product_id) references public.products(tenant_id,id),
  foreign key (tenant_id,location_id) references public.stock_locations(tenant_id,id)
);
alter table public.stock_movements add constraint stock_movements_lot_tenant_fk
  foreign key (tenant_id,lot_id) references public.stock_lots(tenant_id,id);

create index if not exists stock_lots_expiry_idx on public.stock_lots(tenant_id,location_id,expiry_date,product_id);
create index if not exists stock_lots_product_location_idx on public.stock_lots(tenant_id,product_id,location_id);
create table if not exists public.stock_lot_movements (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, lot_id uuid not null,
  stock_movement_id uuid not null references public.stock_movements(id) on delete restrict,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,lot_id) references public.stock_lots(tenant_id,id),
  unique (lot_id,stock_movement_id)
);
create index if not exists stock_lot_movements_lot_idx on public.stock_lot_movements(tenant_id,lot_id,created_at desc);

alter table public.stock_lots enable row level security;
alter table public.stock_lot_movements enable row level security;
create policy "members read stock lots" on public.stock_lots for select to authenticated
  using (public.is_tenant_member(tenant_id));
create policy "members read stock lot movements" on public.stock_lot_movements for select to authenticated
  using (public.is_tenant_member(tenant_id));
grant select on public.stock_lots,public.stock_lot_movements to authenticated;

create or replace view public.stock_lot_balances with (security_invoker = true) as
select tenant_id,lot_id,sum(quantity_delta)::numeric(14,3) as quantity_on_hand
from public.stock_lot_movements group by tenant_id,lot_id;
grant select on public.stock_lot_balances to authenticated;

create or replace function public.apply_stock_lot_movement()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_remaining numeric(14,3);
  v_take numeric(14,3);
  v_lot record;
begin
  select * into v_product from public.products where id=new.product_id and tenant_id=new.tenant_id;
  if not found or not v_product.track_lots then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    new.tenant_id::text || ':' || new.location_id::text || ':' || new.product_id::text || ':lots',0));

  if new.quantity_delta > 0 then
    if new.lot_id is null then raise exception 'A lot number and expiry date are required for this stock entry'; end if;
    if not exists (select 1 from public.stock_lots l where l.id=new.lot_id and l.tenant_id=new.tenant_id
      and l.product_id=new.product_id and l.location_id=new.location_id) then
      raise exception 'Lot does not match this product and location';
    end if;
    insert into public.stock_lot_movements(tenant_id,lot_id,stock_movement_id,quantity_delta)
      values(new.tenant_id,new.lot_id,new.id,new.quantity_delta);
    return new;
  end if;

  if new.lot_id is not null then raise exception 'Outgoing stock is allocated automatically by expiry date'; end if;
  v_remaining := abs(new.quantity_delta);
  for v_lot in
    select l.id,coalesce(sum(m.quantity_delta),0)::numeric(14,3) as available
    from public.stock_lots l
    left join public.stock_lot_movements m on m.tenant_id=l.tenant_id and m.lot_id=l.id
    where l.tenant_id=new.tenant_id and l.product_id=new.product_id and l.location_id=new.location_id
      and l.expiry_date >= current_date
    group by l.id,l.expiry_date,l.received_at
    having coalesce(sum(m.quantity_delta),0) > 0
    order by l.expiry_date asc,l.received_at asc,l.id
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining,v_lot.available);
    insert into public.stock_lot_movements(tenant_id,lot_id,stock_movement_id,quantity_delta)
      values(new.tenant_id,v_lot.id,new.id,-v_take);
    v_remaining := v_remaining-v_take;
  end loop;
  if v_remaining > 0 then raise exception 'Insufficient non-expired lot stock. Missing quantity: %',v_remaining; end if;
  return new;
end;
$$;
drop trigger if exists stock_movements_apply_lots on public.stock_movements;
create trigger stock_movements_apply_lots after insert on public.stock_movements
  for each row execute function public.apply_stock_lot_movement();
revoke all on function public.apply_stock_lot_movement() from public,anon,authenticated;

create or replace function public.receive_stock_lot(
  p_tenant_id uuid,p_product_id uuid,p_location_id uuid,p_lot_code text,
  p_expiry_date date,p_quantity numeric,p_note text default ''
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_lot_id uuid; v_current numeric(14,3);
begin
  if auth.uid() is null or not public.has_tenant_role(
    p_tenant_id,array['owner','admin','manager','stock']::public.tenant_role[]
  ) then raise exception 'Insufficient permissions'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000 then raise exception 'Invalid lot quantity'; end if;
  if p_lot_code is null or length(trim(p_lot_code)) not between 1 and 80 then raise exception 'Invalid lot code'; end if;
  if p_expiry_date is null then raise exception 'Expiry date is required'; end if;
  if not exists(select 1 from public.products p where p.id=p_product_id and p.tenant_id=p_tenant_id and p.is_active and p.track_stock) then
    raise exception 'Stock-tracked product unavailable';
  end if;
  if not exists(select 1 from public.stock_locations l where l.id=p_location_id and l.tenant_id=p_tenant_id and l.is_active) then
    raise exception 'Stock location unavailable';
  end if;
  select coalesce(sum(quantity_on_hand),0) into v_current from public.stock_balances
    where tenant_id=p_tenant_id and product_id=p_product_id;
  if not exists(select 1 from public.products where id=p_product_id and tenant_id=p_tenant_id and track_lots)
     and v_current > 0 then
    raise exception 'Existing stock must be inventoried by lot before lot tracking can be enabled';
  end if;
  update public.products set track_lots=true where id=p_product_id and tenant_id=p_tenant_id;
  insert into public.stock_lots(tenant_id,product_id,location_id,lot_code,expiry_date,created_by)
    values(p_tenant_id,p_product_id,p_location_id,trim(p_lot_code),p_expiry_date,auth.uid())
    on conflict (tenant_id,product_id,location_id,lot_code)
    do update set expiry_date=excluded.expiry_date
    where public.stock_lots.expiry_date=excluded.expiry_date returning id into v_lot_id;
  if v_lot_id is null then raise exception 'Lot code already exists with a different expiry date'; end if;
  insert into public.stock_movements(tenant_id,location_id,product_id,lot_id,movement_type,quantity_delta,reference,note,created_by)
    values(p_tenant_id,p_location_id,p_product_id,v_lot_id,'receipt',p_quantity,
      'LOT-'||trim(p_lot_code),left(coalesce(p_note,''),500),auth.uid());
  return v_lot_id;
end;
$$;
revoke all on function public.receive_stock_lot(uuid,uuid,uuid,text,date,numeric,text) from public,anon;
grant execute on function public.receive_stock_lot(uuid,uuid,uuid,text,date,numeric,text) to authenticated;
