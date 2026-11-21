-- Sprint 9: tenant-scoped customers, sale attribution and controlled returns.
-- Additive only: existing sales and financial records remain untouched.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

-- Empty phone numbers are not unique customer identifiers.
create unique index customers_tenant_phone_unique
  on public.customers(tenant_id, phone) where phone <> '';
create index customers_tenant_name_idx on public.customers(tenant_id, lower(name));

alter table public.sales add column customer_id uuid;
alter table public.sales
  add constraint sales_customer_tenant_fk
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id);

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  location_id uuid not null,
  client_return_id uuid not null,
  refund_method text not null check (refund_method in ('cash','mobile_money','card','bank_transfer','credit_note')),
  refund_total numeric(14,2) not null check (refund_total > 0),
  reason text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, client_return_id),
  foreign key (tenant_id, sale_id) references public.sales(tenant_id, id),
  foreign key (tenant_id, location_id) references public.stock_locations(tenant_id, id)
);
create index sale_returns_tenant_date_idx on public.sale_returns(tenant_id, created_at desc);
create index sale_returns_tenant_sale_idx on public.sale_returns(tenant_id, sale_id, created_at desc);

create table public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_return_id uuid not null,
  sale_item_id uuid not null,
  product_id uuid not null,
  product_name text not null,
  sku text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_rate numeric(5,2) not null check (tax_rate between 0 and 100),
  line_total numeric(14,2) not null check (line_total > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, sale_return_id) references public.sale_returns(tenant_id, id),
  foreign key (tenant_id, sale_item_id) references public.sale_items(tenant_id, id),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id)
);
create index sale_return_items_return_idx on public.sale_return_items(tenant_id, sale_return_id);
create index sale_return_items_sale_line_idx on public.sale_return_items(tenant_id, sale_item_id);

alter table public.customers enable row level security;
alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;

create policy "tenant members read customers" on public.customers
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "tenant members read sale returns" on public.sale_returns
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "tenant members read sale return items" on public.sale_return_items
  for select to authenticated using (public.is_tenant_member(tenant_id));

-- Public-schema tables are explicitly exposed to authenticated only; writes go through checked RPCs.
grant select on public.customers, public.sale_returns, public.sale_return_items to authenticated;
revoke all on public.customers, public.sale_returns, public.sale_return_items from anon;
revoke insert, update, delete on public.customers, public.sale_returns, public.sale_return_items from authenticated;

-- Permit only the one-time customer attribution on an otherwise immutable completed sale.
create or replace function public.guard_sale_header()
returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Completed sales cannot be deleted'; end if;
  if old.status='completed'
     and old.customer_id is null
     and new.customer_id is not null
     and (to_jsonb(new) - 'customer_id') = (to_jsonb(old) - 'customer_id') then
    return new;
  end if;
  if old.status <> 'draft' or new.status <> 'completed' then
    raise exception 'Completed sales are immutable';
  end if;
  return new;
end;
$$;

create or replace function public.create_customer(
  p_tenant_id uuid,
  p_name text,
  p_phone text default '',
  p_email text default '',
  p_address text default '',
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare new_customer_id uuid;
begin
  if auth.uid() is null or not public.has_tenant_role(p_tenant_id, array['owner','admin','manager','cashier']::public.tenant_role[]) then
    raise exception 'Permission denied to create customer';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 160
     or length(coalesce(p_phone,'')) > 40
     or length(coalesce(p_email,'')) > 254
     or length(coalesce(p_address,'')) > 500
     or length(coalesce(p_notes,'')) > 1000 then
    raise exception 'Invalid customer information';
  end if;
  insert into public.customers(tenant_id,name,phone,email,address,notes,created_by)
  values(p_tenant_id,trim(p_name),trim(coalesce(p_phone,'')),lower(trim(coalesce(p_email,''))),
         trim(coalesce(p_address,'')),trim(coalesce(p_notes,'')),auth.uid())
  returning id into new_customer_id;
  return new_customer_id;
end;
$$;

create or replace function public.set_sale_customer(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_customer_id uuid
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_tenant_role(p_tenant_id, array['owner','admin','manager','cashier']::public.tenant_role[]) then
    raise exception 'Permission denied to assign customer';
  end if;
  if not exists (select 1 from public.customers c where c.id=p_customer_id and c.tenant_id=p_tenant_id and c.is_active) then
    raise exception 'Customer not found or inactive';
  end if;
  update public.sales
     set customer_id=p_customer_id
   where id=p_sale_id and tenant_id=p_tenant_id and status='completed' and customer_id is null;
  if not found then raise exception 'Sale not found or already linked to a customer'; end if;
end;
$$;

create or replace function public.register_sale_return(
  p_tenant_id uuid,
  p_sale_item_id uuid,
  p_quantity numeric,
  p_refund_method text,
  p_reason text,
  p_client_return_id uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.sale_items%rowtype;
  v_sale public.sales%rowtype;
  v_already_returned numeric(14,3);
  v_returnable numeric(14,3);
  v_refund numeric(14,2);
  v_return_id uuid;
begin
  if auth.uid() is null or not public.has_tenant_role(p_tenant_id, array['owner','admin','manager','cashier']::public.tenant_role[]) then
    raise exception 'Permission denied to register sale return';
  end if;
  if p_client_return_id is null or p_quantity is null or p_quantity <= 0 or p_quantity > 1000000
     or p_refund_method not in ('cash','mobile_money','card','bank_transfer','credit_note')
     or length(trim(coalesce(p_reason,''))) not between 2 and 250 then
    raise exception 'Invalid return information';
  end if;

  select id into v_return_id from public.sale_returns
   where tenant_id=p_tenant_id and client_return_id=p_client_return_id;
  if v_return_id is not null then return v_return_id; end if;

  select * into v_item from public.sale_items
   where id=p_sale_item_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'Sale line not found'; end if;
  select * into v_sale from public.sales
   where id=v_item.sale_id and tenant_id=p_tenant_id and status='completed' for update;
  if not found then raise exception 'Completed sale not found'; end if;

  select coalesce(sum(ri.quantity),0) into v_already_returned
    from public.sale_return_items ri
   where ri.tenant_id=p_tenant_id and ri.sale_item_id=v_item.id;
  v_returnable := v_item.quantity - v_already_returned;
  if p_quantity > v_returnable then
    raise exception 'Returned quantity exceeds the remaining quantity: %', v_returnable;
  end if;

  v_refund := round(p_quantity * v_item.unit_price * (1 + v_item.tax_rate / 100), 2);
  if v_refund <= 0 then raise exception 'Return amount must be positive'; end if;

  insert into public.sale_returns(
    tenant_id,sale_id,location_id,client_return_id,refund_method,refund_total,reason,created_by
  ) values (
    p_tenant_id,v_sale.id,v_sale.location_id,p_client_return_id,p_refund_method,v_refund,trim(p_reason),auth.uid()
  ) returning id into v_return_id;

  insert into public.sale_return_items(
    tenant_id,sale_return_id,sale_item_id,product_id,product_name,sku,quantity,unit_price,tax_rate,line_total
  ) values (
    p_tenant_id,v_return_id,v_item.id,v_item.product_id,v_item.product_name,v_item.sku,
    p_quantity,v_item.unit_price,v_item.tax_rate,v_refund
  );

  insert into public.stock_movements(
    tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by
  ) values (
    p_tenant_id,v_sale.location_id,v_item.product_id,'sale_return',p_quantity,
    'RETURN-'||v_return_id::text,'Retour client : '||trim(p_reason),auth.uid()
  );

  return v_return_id;
end;
$$;

revoke all on function public.create_customer(uuid,text,text,text,text,text) from public, anon;
revoke all on function public.set_sale_customer(uuid,uuid,uuid) from public, anon;
revoke all on function public.register_sale_return(uuid,uuid,numeric,text,text,uuid) from public, anon;
grant execute on function public.create_customer(uuid,text,text,text,text,text) to authenticated;
grant execute on function public.set_sale_customer(uuid,uuid,uuid) to authenticated;
grant execute on function public.register_sale_return(uuid,uuid,numeric,text,text,uuid) to authenticated;
