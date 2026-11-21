-- iDIABA Sprint 8: controlled physical inventory counts.
-- Counts snapshot the ledger when each line is entered. Posting refuses stale lines
-- and appends correcting movements; the immutable stock ledger remains the source of truth.

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  reference text not null default '',
  notes text not null default '',
  status text not null default 'draft' check (status in ('draft','posted')),
  created_by uuid not null references auth.users(id),
  posted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  unique (tenant_id, id),
  constraint inventory_count_location_tenant_fk
    foreign key (tenant_id, location_id)
    references public.stock_locations(tenant_id, id),
  check ((status = 'draft' and posted_at is null and posted_by is null)
      or (status = 'posted' and posted_at is not null and posted_by is not null))
);

create table if not exists public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  inventory_count_id uuid not null,
  product_id uuid not null,
  expected_quantity numeric(14,3) not null check (expected_quantity >= 0),
  counted_quantity numeric(14,3) not null check (counted_quantity >= 0),
  variance numeric(14,3) generated always as (counted_quantity - expected_quantity) stored,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, inventory_count_id, product_id),
  constraint inventory_count_item_count_fk
    foreign key (tenant_id, inventory_count_id)
    references public.inventory_counts(tenant_id, id) on delete cascade,
  constraint inventory_count_item_product_fk
    foreign key (tenant_id, product_id)
    references public.products(tenant_id, id)
);

create index if not exists inventory_counts_tenant_created_idx
  on public.inventory_counts(tenant_id, created_at desc);
create index if not exists inventory_count_items_count_idx
  on public.inventory_count_items(tenant_id, inventory_count_id);

alter table public.inventory_counts enable row level security;
alter table public.inventory_count_items enable row level security;

drop policy if exists "members read inventory counts" on public.inventory_counts;
create policy "members read inventory counts"
  on public.inventory_counts for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists "members read inventory count items" on public.inventory_count_items;
create policy "members read inventory count items"
  on public.inventory_count_items for select to authenticated
  using (public.is_tenant_member(tenant_id));

revoke all on public.inventory_counts from anon, authenticated;
revoke all on public.inventory_count_items from anon, authenticated;
grant select on public.inventory_counts, public.inventory_count_items to authenticated;

create or replace function public.guard_inventory_count_header()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.status = 'posted' then
    raise exception 'Posted inventory counts are immutable';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Inventory counts cannot be deleted; keep the audit trail';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_count_header_immutable on public.inventory_counts;
create trigger inventory_count_header_immutable
  before update or delete on public.inventory_counts
  for each row execute function public.guard_inventory_count_header();

create or replace function public.guard_inventory_count_item()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_status text; v_count_id uuid; v_tenant_id uuid;
begin
  v_count_id := case when tg_op = 'DELETE' then old.inventory_count_id else new.inventory_count_id end;
  v_tenant_id := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  select status into v_status from public.inventory_counts
    where id = v_count_id and tenant_id = v_tenant_id;
  if v_status is distinct from 'draft' then
    raise exception 'Inventory lines can only be changed while the count is a draft';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists inventory_count_item_draft_only on public.inventory_count_items;
create trigger inventory_count_item_draft_only
  before insert or update or delete on public.inventory_count_items
  for each row execute function public.guard_inventory_count_item();

create or replace function public.create_inventory_count(
  p_tenant_id uuid,
  p_location_id uuid,
  p_reference text default '',
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.has_tenant_role(
    p_tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]
  ) then
    raise exception 'Permission denied to create an inventory count';
  end if;
  if not exists (
    select 1 from public.stock_locations
    where id = p_location_id and tenant_id = p_tenant_id and is_active = true
  ) then
    raise exception 'Invalid or inactive stock location';
  end if;
  insert into public.inventory_counts(tenant_id, location_id, reference, notes, created_by)
  values(p_tenant_id, p_location_id, left(trim(coalesce(p_reference,'')),80),
         left(trim(coalesce(p_notes,'')),500), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_inventory_count_line(
  p_inventory_count_id uuid,
  p_product_id uuid,
  p_counted_quantity numeric
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_expected numeric(14,3);
  v_item_id uuid;
begin
  if auth.uid() is null or p_counted_quantity is null or p_counted_quantity < 0
     or p_counted_quantity > 1000000000 then
    raise exception 'Invalid counted quantity';
  end if;

  select * into v_count from public.inventory_counts
    where id = p_inventory_count_id for update;
  if not found or v_count.status <> 'draft' then
    raise exception 'Inventory count is unavailable or already posted';
  end if;
  if not public.has_tenant_role(
    v_count.tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]
  ) then
    raise exception 'Permission denied to update this inventory count';
  end if;
  if not exists (
    select 1 from public.products
    where id = p_product_id and tenant_id = v_count.tenant_id and is_active = true
  ) then
    raise exception 'Product is unavailable or belongs to another company';
  end if;

  select coalesce(sum(quantity_delta),0)::numeric(14,3) into v_expected
    from public.stock_movements
    where tenant_id = v_count.tenant_id
      and location_id = v_count.location_id
      and product_id = p_product_id;

  insert into public.inventory_count_items(
    tenant_id, inventory_count_id, product_id, expected_quantity, counted_quantity
  ) values (
    v_count.tenant_id, v_count.id, p_product_id, v_expected, round(p_counted_quantity,3)
  )
  on conflict (tenant_id, inventory_count_id, product_id)
  do update set expected_quantity = excluded.expected_quantity,
                counted_quantity = excluded.counted_quantity
  returning id into v_item_id;

  return v_item_id;
end;
$$;

create or replace function public.post_inventory_count(
  p_inventory_count_id uuid
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_line public.inventory_count_items%rowtype;
  v_current numeric(14,3);
  v_delta numeric(14,3);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select * into v_count from public.inventory_counts
    where id = p_inventory_count_id for update;
  if not found or v_count.status <> 'draft' then
    raise exception 'Inventory count is unavailable or already posted';
  end if;
  if not public.has_tenant_role(
    v_count.tenant_id, array['owner','admin','manager','stock']::public.tenant_role[]
  ) then
    raise exception 'Permission denied to post this inventory count';
  end if;
  if not exists (
    select 1 from public.inventory_count_items
    where tenant_id = v_count.tenant_id and inventory_count_id = v_count.id
  ) then
    raise exception 'Add at least one product before posting the inventory';
  end if;

  for v_line in
    select * from public.inventory_count_items
    where tenant_id = v_count.tenant_id and inventory_count_id = v_count.id
    order by product_id
    for update
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      v_count.tenant_id::text || ':' || v_count.location_id::text || ':' || v_line.product_id::text, 0
    ));

    select coalesce(sum(quantity_delta),0)::numeric(14,3) into v_current
      from public.stock_movements
      where tenant_id = v_count.tenant_id
        and location_id = v_count.location_id
        and product_id = v_line.product_id;

    if v_current <> v_line.expected_quantity then
      raise exception 'Stock changed after counting product %. Refresh and count it again.',
        v_line.product_id;
    end if;

    v_delta := v_line.counted_quantity - v_current;
    if v_delta <> 0 then
      insert into public.stock_movements(
        tenant_id, location_id, product_id, movement_type, quantity_delta,
        reference, note, created_by
      ) values (
        v_count.tenant_id, v_count.location_id, v_line.product_id, 'adjustment', v_delta,
        coalesce(nullif(v_count.reference,''),'INV-' || left(v_count.id::text,8)),
        'Ajustement issu de l''inventaire physique ' || left(v_count.id::text,8),
        auth.uid()
      );
    end if;
  end loop;

  update public.inventory_counts
    set status = 'posted', posted_by = auth.uid(), posted_at = now()
    where id = v_count.id and tenant_id = v_count.tenant_id;

  return v_count.id;
end;
$$;

revoke all on function public.guard_inventory_count_header() from public, anon, authenticated;
revoke all on function public.guard_inventory_count_item() from public, anon, authenticated;
revoke all on function public.create_inventory_count(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.set_inventory_count_line(uuid,uuid,numeric) from public, anon, authenticated;
revoke all on function public.post_inventory_count(uuid) from public, anon, authenticated;

grant execute on function public.create_inventory_count(uuid,uuid,text,text) to authenticated;
grant execute on function public.set_inventory_count_line(uuid,uuid,numeric) to authenticated;
grant execute on function public.post_inventory_count(uuid) to authenticated;
