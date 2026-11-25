-- Commercial documents: quotes, customer orders and invoices generated from completed POS sales.
-- Additive only: existing sales, stock and accounting records are never rewritten.

create table if not exists public.commercial_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_number text not null,
  document_type text not null check (document_type in ('quote','sales_order','invoice')),
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected','converted','cancelled','issued','partially_paid','paid')),
  customer_id uuid references public.customers(id) on delete restrict,
  source_document_id uuid,
  source_sale_id uuid references public.sales(id) on delete restrict,
  issue_date date not null default current_date,
  valid_until date,
  due_date date,
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_total numeric(14,2) not null default 0 check (tax_total >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0 and paid_amount <= total),
  notes text not null default '' check (length(notes) <= 2000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_documents_tenant_number_unique unique (tenant_id, document_number),
  constraint commercial_documents_tenant_id_unique unique (tenant_id, id),
  constraint commercial_documents_source_sale_unique unique (tenant_id, source_sale_id),
  constraint commercial_documents_source_document_fk
    foreign key (tenant_id, source_document_id)
    references public.commercial_documents(tenant_id, id) on delete restrict,
  constraint commercial_documents_customer_tenant_fk
    foreign key (tenant_id, customer_id)
    references public.customers(tenant_id, id) on delete restrict
);

create table if not exists public.commercial_document_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  document_id uuid not null,
  product_id uuid references public.products(id) on delete restrict,
  product_name text not null,
  sku text not null default '',
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  tax_rate numeric(5,2) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  line_subtotal numeric(14,2) not null check (line_subtotal >= 0),
  line_tax numeric(14,2) not null check (line_tax >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  constraint commercial_document_items_document_fk
    foreign key (tenant_id, document_id)
    references public.commercial_documents(tenant_id, id) on delete restrict,
  constraint commercial_document_items_product_tenant_fk
    foreign key (tenant_id, product_id)
    references public.products(tenant_id, id) on delete restrict
);

create index if not exists idx_commercial_documents_tenant_date
  on public.commercial_documents(tenant_id, issue_date desc, created_at desc);
create index if not exists idx_commercial_documents_customer
  on public.commercial_documents(tenant_id, customer_id, issue_date desc);
create index if not exists idx_commercial_document_items_document
  on public.commercial_document_items(tenant_id, document_id);

alter table public.commercial_documents enable row level security;
alter table public.commercial_document_items enable row level security;

revoke all on public.commercial_documents from anon, public;
revoke all on public.commercial_document_items from anon, public;
grant select on public.commercial_documents to authenticated;
grant select on public.commercial_document_items to authenticated;

drop policy if exists commercial_documents_read on public.commercial_documents;
create policy commercial_documents_read on public.commercial_documents
for select to authenticated
using (
  private.has_tenant_permission(tenant_id, 'sales_read')
  or private.has_tenant_permission(tenant_id, 'sales_manage')
);

drop policy if exists commercial_document_items_read on public.commercial_document_items;
create policy commercial_document_items_read on public.commercial_document_items
for select to authenticated
using (
  private.has_tenant_permission(tenant_id, 'sales_read')
  or private.has_tenant_permission(tenant_id, 'sales_manage')
);

create or replace function public.create_commercial_document(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_document_type text,
  p_valid_until date,
  p_due_date date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_document_id uuid := gen_random_uuid();
  v_document_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_product_id uuid;
  v_quantity numeric(14,3);
  v_unit_price numeric(14,2);
  v_tax_rate numeric(5,2);
  v_line_subtotal numeric(14,2);
  v_line_tax numeric(14,2);
  v_line_total numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_count integer := 0;
  v_currency text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not private.has_tenant_permission(p_tenant_id, 'sales_manage') then
    raise exception 'Insufficient permissions';
  end if;
  if p_document_type not in ('quote','sales_order') then
    raise exception 'Unsupported commercial document type';
  end if;
  if p_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.tenant_id = p_tenant_id and c.is_active
  ) then raise exception 'Customer not found or inactive'; end if;
  if p_valid_until is not null and p_valid_until < current_date then
    raise exception 'Quote validity date cannot be in the past';
  end if;
  if p_due_date is not null and p_due_date < current_date then
    raise exception 'Due date cannot be in the past';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception 'Document must contain between 1 and 100 lines';
  end if;

  select currency_code into v_currency from public.tenants where id = p_tenant_id;
  if v_currency is null then raise exception 'Company not found'; end if;

  v_document_number := case when p_document_type='quote' then 'DEV-' else 'CMD-' end
    || to_char(current_date,'YYYYMMDD') || '-'
    || upper(substr(replace(v_document_id::text,'-',''),1,8));

  insert into public.commercial_documents(
    id, tenant_id, document_number, document_type, status, customer_id,
    valid_until, due_date, currency_code, notes, created_by
  ) values (
    v_document_id, p_tenant_id, v_document_number, p_document_type, 'draft',
    p_customer_id, case when p_document_type='quote' then p_valid_until else null end,
    p_due_date, v_currency, left(coalesce(p_notes,''),2000), v_user_id
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    if v_product_id is null or v_quantity is null or v_quantity <= 0 or v_quantity > 1000000 then
      raise exception 'Invalid product or quantity';
    end if;

    select * into v_product from public.products
    where id=v_product_id and tenant_id=p_tenant_id and is_active;
    if not found then raise exception 'Product not found or inactive'; end if;

    v_unit_price := coalesce((v_item->>'unit_price')::numeric, v_product.sale_price);
    v_tax_rate := coalesce((v_item->>'tax_rate')::numeric, v_product.tax_rate);
    if v_unit_price < 0 or v_unit_price > 999999999999
       or v_tax_rate < 0 or v_tax_rate > 100 then
      raise exception 'Invalid line price or tax rate';
    end if;

    v_line_subtotal := round(v_quantity * v_unit_price,2);
    v_line_tax := round(v_line_subtotal * v_tax_rate / 100,2);
    v_line_total := v_line_subtotal + v_line_tax;

    insert into public.commercial_document_items(
      tenant_id, document_id, product_id, product_name, sku, quantity,
      unit_price, tax_rate, line_subtotal, line_tax, line_total
    ) values (
      p_tenant_id, v_document_id, v_product.id, v_product.name, v_product.sku,
      v_quantity, v_unit_price, v_tax_rate, v_line_subtotal, v_line_tax, v_line_total
    );

    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax_total := v_tax_total + v_line_tax;
    v_total := v_total + v_line_total;
  end loop;

  if v_count < 1 then raise exception 'Empty document'; end if;
  update public.commercial_documents
  set subtotal=v_subtotal, tax_total=v_tax_total, total=v_total, updated_at=now()
  where id=v_document_id and tenant_id=p_tenant_id;

  return v_document_id;
end;
$function$;

create or replace function public.update_commercial_document_status(
  p_document_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare v_document public.commercial_documents%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_document from public.commercial_documents
  where id=p_document_id for update;
  if not found then raise exception 'Document not found'; end if;
  if not private.has_tenant_permission(v_document.tenant_id, 'sales_manage') then
    raise exception 'Insufficient permissions';
  end if;
  if v_document.document_type <> 'quote'
     or v_document.status not in ('draft','sent','accepted')
     or p_status not in ('sent','accepted','rejected','cancelled') then
    raise exception 'Invalid document status transition';
  end if;
  update public.commercial_documents set status=p_status, updated_at=now()
  where id=v_document.id and tenant_id=v_document.tenant_id;
end;
$function$;

create or replace function public.convert_quote_to_order(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_quote public.commercial_documents%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_order_number text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_quote from public.commercial_documents where id=p_quote_id for update;
  if not found then raise exception 'Quote not found'; end if;
  if not private.has_tenant_permission(v_quote.tenant_id, 'sales_manage') then
    raise exception 'Insufficient permissions';
  end if;
  if v_quote.document_type <> 'quote' or v_quote.status not in ('draft','sent','accepted') then
    raise exception 'Quote cannot be converted';
  end if;

  v_order_number := 'CMD-' || to_char(current_date,'YYYYMMDD') || '-'
    || upper(substr(replace(v_order_id::text,'-',''),1,8));

  insert into public.commercial_documents(
    id, tenant_id, document_number, document_type, status, customer_id,
    source_document_id, issue_date, due_date, currency_code, subtotal,
    tax_total, total, notes, created_by
  ) values (
    v_order_id, v_quote.tenant_id, v_order_number, 'sales_order', 'draft',
    v_quote.customer_id, v_quote.id, current_date, v_quote.due_date,
    v_quote.currency_code, v_quote.subtotal, v_quote.tax_total, v_quote.total,
    v_quote.notes, auth.uid()
  );

  insert into public.commercial_document_items(
    tenant_id, document_id, product_id, product_name, sku, quantity,
    unit_price, tax_rate, line_subtotal, line_tax, line_total
  )
  select tenant_id, v_order_id, product_id, product_name, sku, quantity,
    unit_price, tax_rate, line_subtotal, line_tax, line_total
  from public.commercial_document_items
  where tenant_id=v_quote.tenant_id and document_id=v_quote.id;

  update public.commercial_documents set status='converted', updated_at=now()
  where id=v_quote.id and tenant_id=v_quote.tenant_id;
  return v_order_id;
end;
$function$;

create or replace function public.create_invoice_from_sale(p_tenant_id uuid, p_sale_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'private'
as $function$
declare
  v_sale public.sales%rowtype;
  v_invoice_id uuid := gen_random_uuid();
  v_invoice_number text;
  v_paid numeric(14,2);
  v_currency text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_tenant_permission(p_tenant_id, 'sales_manage') then
    raise exception 'Insufficient permissions';
  end if;
  select * into v_sale from public.sales
  where id=p_sale_id and tenant_id=p_tenant_id and status='completed';
  if not found then raise exception 'Completed sale not found'; end if;
  if exists(select 1 from public.commercial_documents where tenant_id=p_tenant_id and source_sale_id=p_sale_id) then
    raise exception 'Invoice already exists for this sale';
  end if;

  select currency_code into v_currency from public.tenants where id=p_tenant_id;
  select coalesce(sum(amount),0) into v_paid from public.sale_payments
  where tenant_id=p_tenant_id and sale_id=p_sale_id;

  v_invoice_number := 'FAC-' || to_char(coalesce(v_sale.completed_at,v_sale.created_at)::date,'YYYYMMDD')
    || '-' || upper(substr(replace(v_invoice_id::text,'-',''),1,8));

  insert into public.commercial_documents(
    id, tenant_id, document_number, document_type, status, customer_id,
    source_sale_id, issue_date, due_date, currency_code, subtotal, tax_total,
    total, paid_amount, notes, created_by
  ) values (
    v_invoice_id, p_tenant_id, v_invoice_number, 'invoice',
    case when v_paid >= v_sale.total then 'paid' else 'issued' end,
    v_sale.customer_id, p_sale_id, coalesce(v_sale.completed_at,v_sale.created_at)::date,
    null, coalesce(v_currency,'XOF'), v_sale.subtotal, v_sale.tax_total,
    v_sale.total, least(v_paid,v_sale.total), 'Facture issue de la vente ' || left(p_sale_id::text,8),
    auth.uid()
  );

  insert into public.commercial_document_items(
    tenant_id, document_id, product_id, product_name, sku, quantity,
    unit_price, tax_rate, line_subtotal, line_tax, line_total
  )
  select tenant_id, v_invoice_id, product_id, product_name, sku, quantity,
    unit_price, tax_rate, line_subtotal, line_tax, line_total
  from public.sale_items
  where tenant_id=p_tenant_id and sale_id=p_sale_id;

  return v_invoice_id;
end;
$function$;

revoke all on function public.create_commercial_document(uuid,uuid,text,date,date,text,jsonb) from public, anon;
revoke all on function public.update_commercial_document_status(uuid,text) from public, anon;
revoke all on function public.convert_quote_to_order(uuid) from public, anon;
revoke all on function public.create_invoice_from_sale(uuid,uuid) from public, anon;
grant execute on function public.create_commercial_document(uuid,uuid,text,date,date,text,jsonb) to authenticated;
grant execute on function public.update_commercial_document_status(uuid,text) to authenticated;
grant execute on function public.convert_quote_to_order(uuid) to authenticated;
grant execute on function public.create_invoice_from_sale(uuid,uuid) to authenticated;
