-- iDIABA: supplier invoices, partial settlements and automatic double-entry posting.
-- Invoice and payment records are tenant-scoped; all financial writes happen through RPCs.

create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  supplier_id uuid not null,
  purchase_order_id uuid not null,
  invoice_number text not null check (length(trim(invoice_number)) between 1 and 100),
  invoice_date date not null,
  due_date date,
  description text not null default '',
  amount numeric(14,2) not null check (amount > 0),
  tax_amount numeric(14,2) not null default 0 check (tax_amount >= 0 and tax_amount <= amount),
  received_goods_amount numeric(14,2) not null default 0 check (received_goods_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0 and paid_amount <= amount),
  status text not null default 'unpaid' check (status in ('unpaid','partially_paid','paid')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, supplier_id, invoice_number),
  foreign key (tenant_id, supplier_id) references public.suppliers(tenant_id, id),
  foreign key (tenant_id, purchase_order_id) references public.purchase_orders(tenant_id, id)
);

create table if not exists public.supplier_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  invoice_id uuid not null,
  payment_account_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  paid_at date not null,
  reference text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id) references public.supplier_invoices(tenant_id, id),
  foreign key (tenant_id, payment_account_id) references public.accounting_accounts(tenant_id, id)
);

create index if not exists supplier_invoices_tenant_status_due_idx
  on public.supplier_invoices(tenant_id, status, due_date, invoice_date desc);
create index if not exists supplier_invoice_payments_tenant_invoice_date_idx
  on public.supplier_invoice_payments(tenant_id, invoice_id, paid_at desc);

alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_payments enable row level security;

create policy "members read supplier invoices" on public.supplier_invoices
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "members read supplier invoice payments" on public.supplier_invoice_payments
  for select to authenticated using (public.is_tenant_member(tenant_id));

grant select on public.supplier_invoices, public.supplier_invoice_payments to authenticated;

create or replace function public.create_supplier_invoice(
  p_tenant_id uuid,
  p_supplier_id uuid,
  p_purchase_order_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_due_date date,
  p_amount numeric,
  p_description text default '',
  p_tax_amount numeric default 0
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_invoice_id uuid := gen_random_uuid();
  v_entry_id uuid := gen_random_uuid();
  v_entry_number text;
  v_payable_account uuid;
  v_purchase_account uuid;
  v_tax_account uuid;
  v_received_goods_amount numeric(14,2) := 0;
  v_amount_ht numeric(14,2);
  v_order public.purchase_orders%rowtype;
begin
  if auth.uid() is null or not public.has_tenant_role(
    p_tenant_id, array['owner','admin','manager','accountant']::public.tenant_role[]
  ) then raise exception 'Permission denied'; end if;

  if length(trim(coalesce(p_invoice_number,''))) not between 1 and 100
    or p_invoice_date is null or (p_due_date is not null and p_due_date < p_invoice_date)
    or p_amount is null or p_amount <= 0 or p_amount > 999999999999
    or p_tax_amount is null or p_tax_amount < 0 or p_tax_amount >= p_amount
    or length(trim(coalesce(p_description,''))) > 250 then
    raise exception 'Invalid supplier invoice';
  end if;

  select * into v_order from public.purchase_orders
    where id=p_purchase_order_id and tenant_id=p_tenant_id and supplier_id=p_supplier_id
    for update;
  if not found or v_order.status not in ('partially_received','received') then
    raise exception 'Invoice must reference a received purchase order for this supplier';
  end if;
  select coalesce(sum(round(i.received_quantity * i.unit_cost,2)),0)::numeric(14,2)
    into v_received_goods_amount
    from public.purchase_order_items i
    where i.tenant_id=p_tenant_id and i.purchase_order_id=p_purchase_order_id
      and i.received_quantity > 0;
  if v_received_goods_amount <= 0 then raise exception 'Purchase order has no received items'; end if;
  v_amount_ht := round(p_amount - p_tax_amount,2);

  perform public.ensure_accounting_chart(p_tenant_id);
  select id into v_payable_account from public.accounting_accounts
    where tenant_id=p_tenant_id and code='401000' and is_active;
  select id into v_purchase_account from public.accounting_accounts
    where tenant_id=p_tenant_id and code='601000' and is_active;
  select id into v_tax_account from public.accounting_accounts
    where tenant_id=p_tenant_id and code='445000' and is_active;
  if v_payable_account is null or v_purchase_account is null
    or (p_tax_amount > 0 and v_tax_account is null) then
    raise exception 'Supplier accounting accounts unavailable';
  end if;

  insert into public.supplier_invoices(
    id,tenant_id,supplier_id,purchase_order_id,invoice_number,invoice_date,due_date,
    description,amount,tax_amount,received_goods_amount,created_by
  ) values (
    v_invoice_id,p_tenant_id,p_supplier_id,p_purchase_order_id,trim(p_invoice_number),
    p_invoice_date,p_due_date,left(trim(coalesce(p_description,'')),250),round(p_amount,2),
    round(p_tax_amount,2),v_received_goods_amount,auth.uid()
  );

  v_entry_number := 'FA-' || to_char(p_invoice_date,'YYYYMMDD') || '-' ||
    upper(substr(replace(v_entry_id::text,'-',''),1,8));
  insert into public.journal_entries(
    id,tenant_id,entry_number,entry_date,description,source_type,source_id,created_by
  ) values (
    v_entry_id,p_tenant_id,v_entry_number,p_invoice_date,
    'Facture fournisseur ' || trim(p_invoice_number),'purchase',v_invoice_id,auth.uid()
  );
  if p_tax_amount > 0 then
    insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit)
    values
      (p_tenant_id,v_entry_id,v_purchase_account,'Achats HT - facture ' || trim(p_invoice_number),v_amount_ht,0),
      (p_tenant_id,v_entry_id,v_tax_account,'TVA récupérable - facture ' || trim(p_invoice_number),round(p_tax_amount,2),0),
      (p_tenant_id,v_entry_id,v_payable_account,'Dette fournisseur ' || trim(p_invoice_number),0,round(p_amount,2));
  else
    insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit)
    values
      (p_tenant_id,v_entry_id,v_purchase_account,'Achats - facture ' || trim(p_invoice_number),round(p_amount,2),0),
      (p_tenant_id,v_entry_id,v_payable_account,'Dette fournisseur ' || trim(p_invoice_number),0,round(p_amount,2));
  end if;

  return v_invoice_id;
end;
$$;

create or replace function public.record_supplier_invoice_payment(
  p_invoice_id uuid,
  p_payment_account_id uuid,
  p_amount numeric,
  p_paid_at date,
  p_reference text default '',
  p_cash_session_id uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_invoice public.supplier_invoices%rowtype;
  v_payment_id uuid := gen_random_uuid();
  v_entry_id uuid := gen_random_uuid();
  v_entry_number text;
  v_payable_account uuid;
  v_remaining numeric(14,2);
  v_payment_account_kind text;
  v_cash_session public.cash_sessions%rowtype;
  v_current_cash numeric(14,2);
begin
  if auth.uid() is null or p_amount is null or p_amount <= 0
    or p_amount > 999999999999 or p_paid_at is null
    or length(trim(coalesce(p_reference,''))) > 100 then
    raise exception 'Invalid supplier payment';
  end if;

  select * into v_invoice from public.supplier_invoices
    where id=p_invoice_id for update;
  if not found or not public.has_tenant_role(
    v_invoice.tenant_id, array['owner','admin','manager','accountant']::public.tenant_role[]
  ) then raise exception 'Permission denied or invoice unavailable'; end if;

  v_remaining := round(v_invoice.amount - v_invoice.paid_amount,2);
  if round(p_amount,2) > v_remaining then
    raise exception 'Payment exceeds outstanding supplier balance';
  end if;

  select account_kind into v_payment_account_kind from public.accounting_accounts
    where id=p_payment_account_id and tenant_id=v_invoice.tenant_id
      and is_active and account_kind in ('cash','bank');
  if v_payment_account_kind is null then raise exception 'Invalid payment account'; end if;

  if v_payment_account_kind='cash' then
    if p_cash_session_id is null then raise exception 'An open cash session is required for cash payments'; end if;
    select * into v_cash_session from public.cash_sessions
      where id=p_cash_session_id and tenant_id=v_invoice.tenant_id for update;
    if not found or v_cash_session.status <> 'open' then raise exception 'Cash session is not open'; end if;
    if v_cash_session.opened_by <> auth.uid() and not public.has_tenant_role(
      v_invoice.tenant_id,array['owner','admin','manager']::public.tenant_role[]
    ) then raise exception 'Permission denied for this cash session'; end if;
    select round(
      v_cash_session.opening_cash
      + coalesce((select sum(sp.amount) from public.sale_payments sp
        join public.sales sa on sa.id=sp.sale_id and sa.tenant_id=sp.tenant_id
        where sp.tenant_id=v_invoice.tenant_id and sa.cash_session_id=v_cash_session.id
          and sa.status='completed' and sp.payment_method='cash'),0)
      + coalesce((select sum(cm.amount) from public.cash_movements cm
        where cm.tenant_id=v_invoice.tenant_id and cm.cash_session_id=v_cash_session.id and cm.movement_type='cash_in'),0)
      - coalesce((select sum(cm.amount) from public.cash_movements cm
        where cm.tenant_id=v_invoice.tenant_id and cm.cash_session_id=v_cash_session.id and cm.movement_type='cash_out'),0)
    ,2) into v_current_cash;
    if round(p_amount,2) > v_current_cash then raise exception 'Cash payment exceeds available cash balance'; end if;
  elsif p_cash_session_id is not null then
    raise exception 'A cash session cannot be attached to a bank payment';
  end if;

  select id into v_payable_account from public.accounting_accounts
    where tenant_id=v_invoice.tenant_id and code='401000' and is_active;
  if v_payable_account is null then raise exception 'Supplier payable account unavailable'; end if;

  insert into public.supplier_invoice_payments(
    id,tenant_id,invoice_id,payment_account_id,amount,paid_at,reference,created_by
  ) values (
    v_payment_id,v_invoice.tenant_id,v_invoice.id,p_payment_account_id,
    round(p_amount,2),p_paid_at,left(trim(coalesce(p_reference,'')),100),auth.uid()
  );

  v_entry_number := 'FP-' || to_char(p_paid_at,'YYYYMMDD') || '-' ||
    upper(substr(replace(v_entry_id::text,'-',''),1,8));
  insert into public.journal_entries(
    id,tenant_id,entry_number,entry_date,description,source_type,source_id,created_by
  ) values (
    v_entry_id,v_invoice.tenant_id,v_entry_number,p_paid_at,
    'Règlement facture fournisseur ' || v_invoice.invoice_number,'cash',v_payment_id,auth.uid()
  );
  insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit)
  values
    (v_invoice.tenant_id,v_entry_id,v_payable_account,'Règlement fournisseur ' || v_invoice.invoice_number,round(p_amount,2),0),
    (v_invoice.tenant_id,v_entry_id,p_payment_account_id,'Décaissement fournisseur ' || v_invoice.invoice_number,0,round(p_amount,2));

  if v_payment_account_kind='cash' then
    insert into public.cash_movements(tenant_id,cash_session_id,movement_type,amount,reason,created_by)
    values(v_invoice.tenant_id,v_cash_session.id,'cash_out',round(p_amount,2),
      left('Règlement fournisseur ' || v_invoice.invoice_number,250),auth.uid());
  end if;

  update public.supplier_invoices
    set paid_amount=round(paid_amount + p_amount,2),
        status=case when round(paid_amount + p_amount,2) >= amount then 'paid' else 'partially_paid' end
    where id=v_invoice.id and tenant_id=v_invoice.tenant_id;

  return v_payment_id;
end;
$$;

revoke all on function public.create_supplier_invoice(uuid,uuid,uuid,text,date,date,numeric,text,numeric) from public;
revoke all on function public.record_supplier_invoice_payment(uuid,uuid,numeric,date,text,uuid) from public;
grant execute on function public.create_supplier_invoice(uuid,uuid,uuid,text,date,date,numeric,text,numeric) to authenticated;
grant execute on function public.record_supplier_invoice_payment(uuid,uuid,numeric,date,text,uuid) to authenticated;
