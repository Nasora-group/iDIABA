-- iDIABA Sprint 29: per-location staff access with backwards-compatible tenant-wide defaults.
create table if not exists public.stock_location_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  location_id uuid not null,
  user_id uuid not null,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,location_id,user_id),
  constraint stock_location_memberships_location_fk
    foreign key (tenant_id,location_id) references public.stock_locations(tenant_id,id) on delete cascade,
  constraint stock_location_memberships_tenant_member_fk
    foreign key (tenant_id,user_id) references public.tenant_memberships(tenant_id,user_id) on delete cascade
);

create index if not exists stock_location_memberships_user_idx
  on public.stock_location_memberships(tenant_id,user_id,location_id);

alter table public.stock_location_memberships enable row level security;

create policy "location managers read assignments" on public.stock_location_memberships
  for select to authenticated
  using (
    user_id=(select auth.uid())
    or public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[])
  );
create policy "location managers assign members" on public.stock_location_memberships
  for insert to authenticated
  with check (
    assigned_by=(select auth.uid())
    and public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[])
  );
create policy "location managers remove assignments" on public.stock_location_memberships
  for delete to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));

grant select,insert,delete on public.stock_location_memberships to authenticated;

create or replace function public.has_stock_location_access(
  target_tenant uuid,
  target_location uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when auth.uid() is null then false
    when public.has_tenant_role(target_tenant,array['owner','admin','manager']::public.tenant_role[]) then true
    when not public.is_tenant_member(target_tenant) then false
    -- Backward compatibility: a location remains tenant-wide until an admin assigns staff.
    when not exists (
      select 1 from public.stock_location_memberships m
      where m.tenant_id=target_tenant and m.location_id=target_location
    ) then true
    else exists (
      select 1 from public.stock_location_memberships m
      where m.tenant_id=target_tenant and m.location_id=target_location and m.user_id=auth.uid()
    )
  end;
$$;

revoke all on function public.has_stock_location_access(uuid,uuid) from public,anon,authenticated;
grant execute on function public.has_stock_location_access(uuid,uuid) to authenticated;

-- Restrict reads to assigned locations once assignments exist.
drop policy if exists "members read stock locations" on public.stock_locations;
create policy "members read assigned stock locations" on public.stock_locations
  for select to authenticated using (public.has_stock_location_access(tenant_id,id));

drop policy if exists "members read stock movements" on public.stock_movements;
create policy "members read assigned stock movements" on public.stock_movements
  for select to authenticated using (public.has_stock_location_access(tenant_id,location_id));

drop policy if exists "stock managers record movements" on public.stock_movements;
create policy "stock managers record assigned movements" on public.stock_movements
  for insert to authenticated
  with check (
    public.has_tenant_role(tenant_id,array['owner','admin','manager','stock']::public.tenant_role[])
    and public.has_stock_location_access(tenant_id,location_id)
  );

drop policy if exists "members read cash sessions" on public.cash_sessions;
create policy "members read assigned cash sessions" on public.cash_sessions
  for select to authenticated using (public.has_stock_location_access(tenant_id,location_id));

drop policy if exists "members read cash movements" on public.cash_movements;
create policy "members read assigned cash movements" on public.cash_movements
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.cash_sessions cs
      where cs.id=cash_session_id and cs.tenant_id=cash_movements.tenant_id
        and public.has_stock_location_access(cs.tenant_id,cs.location_id)
    )
  );

drop policy if exists "members read sales" on public.sales;
create policy "members read assigned sales" on public.sales
  for select to authenticated using (public.has_stock_location_access(tenant_id,location_id));

drop policy if exists "members read sale items" on public.sale_items;
create policy "members read assigned sale items" on public.sale_items
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.sales s where s.id=sale_id and s.tenant_id=sale_items.tenant_id
        and public.has_stock_location_access(s.tenant_id,s.location_id)
    )
  );

drop policy if exists "members read sale payments" on public.sale_payments;
create policy "members read assigned sale payments" on public.sale_payments
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.sales s where s.id=sale_id and s.tenant_id=sale_payments.tenant_id
        and public.has_stock_location_access(s.tenant_id,s.location_id)
    )
  );

drop policy if exists "members read inventory counts" on public.inventory_counts;
create policy "members read assigned inventory counts" on public.inventory_counts
  for select to authenticated using (public.has_stock_location_access(tenant_id,location_id));

drop policy if exists "members read inventory count items" on public.inventory_count_items;
create policy "members read assigned inventory count items" on public.inventory_count_items
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.inventory_counts ic where ic.id=inventory_count_id
        and ic.tenant_id=inventory_count_items.tenant_id
        and public.has_stock_location_access(ic.tenant_id,ic.location_id)
    )
  );

drop policy if exists "members read purchase orders" on public.purchase_orders;
create policy "members read assigned purchase orders" on public.purchase_orders
  for select to authenticated using (public.has_stock_location_access(tenant_id,location_id));

drop policy if exists "members read purchase order items" on public.purchase_order_items;
create policy "members read assigned purchase order items" on public.purchase_order_items
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.purchase_orders po where po.id=purchase_order_id
        and po.tenant_id=purchase_order_items.tenant_id
        and public.has_stock_location_access(po.tenant_id,po.location_id)
    )
  );

drop policy if exists "members read purchase receipts" on public.purchase_receipts;
create policy "members read assigned purchase receipts" on public.purchase_receipts
  for select to authenticated using (public.has_stock_location_access(tenant_id,location_id));

drop policy if exists "members read purchase receipt items" on public.purchase_receipt_items;
create policy "members read assigned purchase receipt items" on public.purchase_receipt_items
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.purchase_receipts pr where pr.id=receipt_id
        and pr.tenant_id=purchase_receipt_items.tenant_id
        and public.has_stock_location_access(pr.tenant_id,pr.location_id)
    )
  );

drop policy if exists "tenant members read sale returns" on public.sale_returns;
create policy "tenant members read assigned sale returns" on public.sale_returns
  for select to authenticated using (public.has_stock_location_access(tenant_id,location_id));

drop policy if exists "tenant members read sale return items" on public.sale_return_items;
create policy "tenant members read assigned sale return items" on public.sale_return_items
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.sale_returns sr where sr.id=sale_return_id
        and sr.tenant_id=sale_return_items.tenant_id
        and public.has_stock_location_access(sr.tenant_id,sr.location_id)
    )
  );

drop policy if exists "tenant members read stock transfers" on public.stock_transfers;
create policy "tenant members read assigned stock transfers" on public.stock_transfers
  for select to authenticated using (
    public.has_stock_location_access(tenant_id,source_location_id)
    and public.has_stock_location_access(tenant_id,destination_location_id)
  );

drop policy if exists "tenant members read stock transfer items" on public.stock_transfer_items;
create policy "tenant members read assigned stock transfer items" on public.stock_transfer_items
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.stock_transfers st where st.id=transfer_id and st.tenant_id=stock_transfer_items.tenant_id
        and public.has_stock_location_access(st.tenant_id,st.source_location_id)
        and public.has_stock_location_access(st.tenant_id,st.destination_location_id)
    )
  );

drop policy if exists "tenant members read stock transfer receipts" on public.stock_transfer_receipts;
create policy "tenant members read assigned stock transfer receipts" on public.stock_transfer_receipts
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.stock_transfers st where st.id=transfer_id and st.tenant_id=stock_transfer_receipts.tenant_id
        and public.has_stock_location_access(st.tenant_id,st.source_location_id)
        and public.has_stock_location_access(st.tenant_id,st.destination_location_id)
    )
  );

drop policy if exists "tenant members read stock transfer receipt items" on public.stock_transfer_receipt_items;
create policy "tenant members read assigned stock transfer receipt items" on public.stock_transfer_receipt_items
  for select to authenticated using (
    public.is_tenant_member(tenant_id) and exists (
      select 1 from public.stock_transfer_receipts r
      join public.stock_transfers st on st.id=r.transfer_id and st.tenant_id=r.tenant_id
      where r.id=receipt_id and r.tenant_id=stock_transfer_receipt_items.tenant_id
        and public.has_stock_location_access(st.tenant_id,st.source_location_id)
        and public.has_stock_location_access(st.tenant_id,st.destination_location_id)
    )
  );

-- Guard SECURITY DEFINER RPCs as well as direct inserts: the trigger checks the caller's
-- assigned location before a privileged routine can write a location-scoped record.
create or replace function public.enforce_stock_location_access()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_tenant_id uuid;
  v_location_id uuid;
  v_other_location_id uuid;
  v_parent_id uuid;
begin
  v_tenant_id := nullif(v_row->>'tenant_id','')::uuid;
  if v_tenant_id is null then return new; end if;

  if tg_table_name='stock_transfers' then
    v_location_id := nullif(v_row->>'source_location_id','')::uuid;
    v_other_location_id := nullif(v_row->>'destination_location_id','')::uuid;
    if not public.has_stock_location_access(v_tenant_id,v_location_id)
       or not public.has_stock_location_access(v_tenant_id,v_other_location_id) then
      raise exception 'You do not have access to both locations in this transfer';
    end if;
    return new;
  elsif tg_table_name='cash_movements' then
    v_parent_id := nullif(v_row->>'cash_session_id','')::uuid;
    select location_id into v_location_id from public.cash_sessions
      where id=v_parent_id and tenant_id=v_tenant_id;
  elsif tg_table_name='sale_returns' then
    v_parent_id := nullif(v_row->>'sale_id','')::uuid;
    select location_id into v_location_id from public.sales
      where id=v_parent_id and tenant_id=v_tenant_id;
  elsif tg_table_name='stock_transfer_receipts' then
    v_parent_id := nullif(v_row->>'transfer_id','')::uuid;
    select destination_location_id into v_location_id from public.stock_transfers
      where id=v_parent_id and tenant_id=v_tenant_id;
  elsif tg_table_name='supplier_invoice_payments' then
    v_parent_id := nullif(v_row->>'cash_session_id','')::uuid;
    if v_parent_id is null then return new; end if;
    select location_id into v_location_id from public.cash_sessions
      where id=v_parent_id and tenant_id=v_tenant_id;
  else
    v_location_id := nullif(v_row->>'location_id','')::uuid;
  end if;

  if v_location_id is null or not public.has_stock_location_access(v_tenant_id,v_location_id) then
    raise exception 'You do not have access to this stock location';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_stock_location_access() from public,anon,authenticated;

drop trigger if exists location_access_guard on public.stock_movements;
create trigger location_access_guard before insert on public.stock_movements
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.cash_sessions;
create trigger location_access_guard before insert or update on public.cash_sessions
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.cash_movements;
create trigger location_access_guard before insert on public.cash_movements
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.sales;
create trigger location_access_guard before insert or update on public.sales
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.purchase_orders;
create trigger location_access_guard before insert or update on public.purchase_orders
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.purchase_receipts;
create trigger location_access_guard before insert on public.purchase_receipts
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.inventory_counts;
create trigger location_access_guard before insert or update on public.inventory_counts
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.sale_returns;
create trigger location_access_guard before insert on public.sale_returns
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.stock_transfers;
create trigger location_access_guard before insert or update on public.stock_transfers
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.stock_transfer_receipts;
create trigger location_access_guard before insert on public.stock_transfer_receipts
  for each row execute function public.enforce_stock_location_access();
drop trigger if exists location_access_guard on public.supplier_invoice_payments;
create trigger location_access_guard before insert on public.supplier_invoice_payments
  for each row execute function public.enforce_stock_location_access();
