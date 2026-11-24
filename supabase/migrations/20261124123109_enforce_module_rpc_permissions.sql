-- Enforce module-level permissions in purchasing, stock, accounting and sales RPCs.

CREATE OR REPLACE FUNCTION public.create_customer(p_tenant_id uuid, p_name text, p_phone text DEFAULT ''::text, p_email text DEFAULT ''::text, p_address text DEFAULT ''::text, p_notes text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare new_customer_id uuid;
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'sales_manage') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_expense(p_tenant_id uuid, p_expense_date date, p_description text, p_amount numeric, p_expense_account_id uuid, p_payment_account_id uuid, p_reference text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_expense uuid:=gen_random_uuid(); v_entry uuid:=gen_random_uuid(); v_number text;
begin
 if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'accounting_manage') then raise exception 'Permission denied'; end if;
 if p_expense_date is null or length(trim(coalesce(p_description,''))) not between 2 and 250 or p_amount is null or p_amount<=0 then raise exception 'Invalid expense'; end if;
 if not exists(select 1 from public.accounting_accounts where id=p_expense_account_id and tenant_id=p_tenant_id and is_active and account_class='expense') then raise exception 'Invalid expense account'; end if;
 if not exists(select 1 from public.accounting_accounts where id=p_payment_account_id and tenant_id=p_tenant_id and is_active and account_kind in ('cash','bank')) then raise exception 'Invalid payment account'; end if;
 v_number:='EX-'||to_char(p_expense_date,'YYYYMMDD')||'-'||upper(substr(replace(v_entry::text,'-',''),1,8));
 insert into public.journal_entries(id,tenant_id,entry_number,entry_date,description,source_type,source_id,created_by) values(v_entry,p_tenant_id,v_number,p_expense_date,trim(p_description),'expense',v_expense,auth.uid());
 insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit) values
 (p_tenant_id,v_entry,p_expense_account_id,trim(p_description),round(p_amount,2),0),
 (p_tenant_id,v_entry,p_payment_account_id,trim(p_description),0,round(p_amount,2));
 insert into public.expenses(id,tenant_id,journal_entry_id,expense_date,description,reference,amount,expense_account_id,payment_account_id,created_by)
 values(v_expense,p_tenant_id,v_entry,p_expense_date,trim(p_description),left(coalesce(p_reference,''),100),round(p_amount,2),p_expense_account_id,p_payment_account_id,auth.uid());
 return v_expense;
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_inventory_count(p_tenant_id uuid, p_location_id uuid, p_reference text DEFAULT ''::text, p_notes text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_id uuid;
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'stock_manage') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_purchase_order(p_tenant_id uuid, p_supplier_id uuid, p_location_id uuid, p_items jsonb, p_notes text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,3);
  v_unit_cost numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.has_tenant_permission(p_tenant_id,'purchasing_manage') then
    raise exception 'Insufficient permissions';
  end if;
  if not exists(select 1 from public.suppliers s where s.id=p_supplier_id and s.tenant_id=p_tenant_id and s.is_active) then
    raise exception 'Supplier unavailable';
  end if;
  if not exists(select 1 from public.stock_locations l where l.id=p_location_id and l.tenant_id=p_tenant_id and l.is_active) then
    raise exception 'Stock location unavailable';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'Order must contain between 1 and 100 lines';
  end if;

  v_order_id := gen_random_uuid();
  v_order_number := 'PO-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 8));
  insert into public.purchase_orders(id, tenant_id, supplier_id, location_id, order_number, notes, created_by)
  values(v_order_id, p_tenant_id, p_supplier_id, p_location_id, v_order_number, left(coalesce(p_notes,''),1000), auth.uid());

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    if v_quantity is null or v_quantity <= 0 or v_quantity > 1000000000
      or v_unit_cost is null or v_unit_cost < 0 or v_unit_cost > 999999999999 then
      raise exception 'Invalid order quantity or unit cost';
    end if;
    if not exists(select 1 from public.products p where p.id=v_product_id and p.tenant_id=p_tenant_id and p.is_active) then
      raise exception 'Product unavailable';
    end if;
    insert into public.purchase_order_items(tenant_id,purchase_order_id,product_id,quantity,unit_cost,line_total)
    values(p_tenant_id,v_order_id,v_product_id,v_quantity,v_unit_cost,round(v_quantity*v_unit_cost,2));
    v_subtotal := v_subtotal + round(v_quantity*v_unit_cost,2);
  end loop;

  update public.purchase_orders set subtotal=v_subtotal,total_amount=v_subtotal,updated_at=now()
  where id=v_order_id and tenant_id=p_tenant_id;
  return v_order_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_stock_transfer(p_tenant_id uuid, p_source_location_id uuid, p_destination_location_id uuid, p_items jsonb, p_client_transfer_id uuid, p_notes text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_transfer_id uuid := gen_random_uuid();
  v_transfer_number text;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric(14,3);
  v_available numeric(14,3);
  v_count integer := 0;
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'stock_manage') then
    raise exception 'Permission denied to create a stock transfer';
  end if;
  if p_client_transfer_id is null then raise exception 'Transfer idempotency key is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_client_transfer_id::text,0));
  select id into v_transfer_id from public.stock_transfers
    where tenant_id=p_tenant_id and client_transfer_id=p_client_transfer_id;
  if found then return v_transfer_id; end if;
  v_transfer_id := gen_random_uuid();
  if p_source_location_id is null or p_destination_location_id is null
     or p_source_location_id = p_destination_location_id then
    raise exception 'Choose two different locations';
  end if;
  if not exists(select 1 from public.stock_locations
    where id=p_source_location_id and tenant_id=p_tenant_id and is_active=true)
    or not exists(select 1 from public.stock_locations
    where id=p_destination_location_id and tenant_id=p_tenant_id and is_active=true) then
    raise exception 'Source or destination location is unavailable';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Transfer items must be an array';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'A transfer must contain between 1 and 100 lines';
  end if;

  v_transfer_number := 'TRF-' || to_char(now(),'YYYYMMDD') || '-' ||
    upper(substr(replace(v_transfer_id::text,'-',''),1,8));

  insert into public.stock_transfers(
    id,tenant_id,source_location_id,destination_location_id,transfer_number,notes,client_transfer_id,created_by
  ) values (
    v_transfer_id,p_tenant_id,p_source_location_id,p_destination_location_id,
    v_transfer_number,left(trim(coalesce(p_notes,'')),1000),p_client_transfer_id,auth.uid()
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    if coalesce(v_item->>'product_id','') !~* '^[0-9a-f-]{36}$' then
      raise exception 'Invalid product identifier';
    end if;
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity is null or v_quantity <= 0 or v_quantity > 1000000000 then
      raise exception 'Invalid transfer quantity';
    end if;
    if not exists(select 1 from public.products
      where id=v_product_id and tenant_id=p_tenant_id and is_active=true) then
      raise exception 'Product is unavailable or belongs to another company';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      p_tenant_id::text || ':' || p_source_location_id::text || ':' || v_product_id::text,0
    ));
    select coalesce(sum(quantity_delta),0)::numeric(14,3) into v_available
      from public.stock_movements
      where tenant_id=p_tenant_id and location_id=p_source_location_id and product_id=v_product_id;
    if v_available < v_quantity then
      raise exception 'Insufficient source stock for product %. Available: %',v_product_id,v_available;
    end if;
    insert into public.stock_transfer_items(tenant_id,transfer_id,product_id,quantity)
      values(p_tenant_id,v_transfer_id,v_product_id,v_quantity);
  end loop;

  return v_transfer_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_supplier_invoice(p_tenant_id uuid, p_supplier_id uuid, p_purchase_order_id uuid, p_invoice_number text, p_invoice_date date, p_due_date date, p_amount numeric, p_description text DEFAULT ''::text, p_tax_amount numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'purchasing_manage') then raise exception 'Permission denied'; end if;

  if length(trim(coalesce(p_invoice_number,''))) not between 1 and 100
    or p_invoice_date is null or (p_due_date is not null and p_due_date < p_invoice_date)
    or p_amount is null or p_amount <= 0 or p_amount > 999999999999
    or p_tax_amount is null or p_tax_amount < 0 or p_tax_amount >= p_amount
    or length(trim(coalesce(p_description,''))) > 250 then
    raise exception 'Invalid supplier invoice'; end if;

  select * into v_order from public.purchase_orders
    where id=p_purchase_order_id and tenant_id=p_tenant_id and supplier_id=p_supplier_id
    for update;
  if not found or v_order.status not in ('partially_received','received') then
    raise exception 'Invoice must reference a received purchase order for this supplier'; end if;
  if not exists (
    select 1 from public.purchase_order_items i
    where i.tenant_id=p_tenant_id and i.purchase_order_id=p_purchase_order_id
      and i.received_quantity > 0
  ) then raise exception 'Purchase order has no received items'; end if;
  select coalesce(sum(round(i.received_quantity * i.unit_cost,2)),0)::numeric(14,2)
    into v_received_goods_amount
    from public.purchase_order_items i
    where i.tenant_id=p_tenant_id and i.purchase_order_id=p_purchase_order_id
      and i.received_quantity > 0;
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
    raise exception 'Supplier accounting accounts unavailable'; end if;

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
$function$
;

CREATE OR REPLACE FUNCTION public.post_inventory_count(p_inventory_count_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  if not private.has_tenant_permission(v_count.tenant_id,'stock_manage') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.post_manual_journal_entry(p_tenant_id uuid, p_entry_date date, p_description text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_id uuid:=gen_random_uuid(); v_number text; v_line jsonb; v_account uuid; v_debit numeric(16,2); v_credit numeric(16,2); v_dr numeric(16,2):=0; v_cr numeric(16,2):=0; v_count int:=0;
begin
 if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'accounting_manage') then raise exception 'Permission denied'; end if;
 if p_entry_date is null or length(trim(coalesce(p_description,''))) not between 2 and 250 or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)<2 or jsonb_array_length(p_lines)>100 then raise exception 'Invalid journal entry'; end if;
 v_number:='OD-'||to_char(p_entry_date,'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8));
 insert into public.journal_entries(id,tenant_id,entry_number,entry_date,description,source_type,created_by) values(v_id,p_tenant_id,v_number,p_entry_date,trim(p_description),'manual',auth.uid());
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_count:=v_count+1; v_account:=(v_line->>'account_id')::uuid;
  v_debit:=round(coalesce((v_line->>'debit')::numeric,0),2); v_credit:=round(coalesce((v_line->>'credit')::numeric,0),2);
  if v_debit<0 or v_credit<0 or not ((v_debit>0 and v_credit=0) or (v_credit>0 and v_debit=0)) then raise exception 'Invalid debit/credit line'; end if;
  if not exists(select 1 from public.accounting_accounts where id=v_account and tenant_id=p_tenant_id and is_active) then raise exception 'Account unavailable'; end if;
  insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit) values(p_tenant_id,v_id,v_account,left(coalesce(v_line->>'description',''),250),v_debit,v_credit);
  v_dr:=v_dr+v_debit; v_cr:=v_cr+v_credit;
 end loop;
 if v_count<2 or v_dr<=0 or v_dr<>v_cr then raise exception 'Journal entry must be balanced'; end if;
 return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(p_purchase_order_id uuid, p_items jsonb, p_notes text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_order public.purchase_orders%rowtype; v_item jsonb; v_line public.purchase_order_items%rowtype;
  v_product public.products%rowtype; v_quantity numeric(14,3); v_receipt_id uuid:=gen_random_uuid();
  v_receipt_number text; v_count integer:=0; v_received_total numeric(14,3):=0;
  v_remaining numeric(14,3); v_lot_code text; v_expiry_date date; v_lot_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_order from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if not private.has_tenant_permission(v_order.tenant_id,'purchasing_manage') then raise exception 'Insufficient permissions'; end if;
  if v_order.status not in ('ordered','partially_received') then raise exception 'Order cannot be received'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then raise exception 'Receipt must contain at least one line'; end if;
  v_receipt_number:='REC-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_receipt_id::text,'-',''),1,8));
  insert into public.purchase_receipts(id,tenant_id,purchase_order_id,location_id,receipt_number,received_by,notes)
  values(v_receipt_id,v_order.tenant_id,v_order.id,v_order.location_id,v_receipt_number,auth.uid(),left(coalesce(p_notes,''),1000));
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_count:=v_count+1;
    select * into v_line from public.purchase_order_items where id=(v_item->>'order_item_id')::uuid
      and tenant_id=v_order.tenant_id and purchase_order_id=v_order.id for update;
    if not found then raise exception 'Order line not found'; end if;
    select * into v_product from public.products where id=v_line.product_id and tenant_id=v_order.tenant_id;
    if not found then raise exception 'Product not found'; end if;
    v_quantity:=(v_item->>'quantity')::numeric; v_remaining:=v_line.quantity-v_line.received_quantity;
    if v_quantity is null or v_quantity<=0 or v_quantity>v_remaining then raise exception 'Received quantity exceeds remaining quantity'; end if;
    insert into public.purchase_receipt_items(tenant_id,receipt_id,purchase_order_item_id,product_id,quantity,unit_cost)
    values(v_order.tenant_id,v_receipt_id,v_line.id,v_line.product_id,v_quantity,v_line.unit_cost);
    if v_product.track_lots then
      v_lot_code:=trim(coalesce(v_item->>'lot_code',''));
      if length(v_lot_code) not between 1 and 80 then raise exception 'Lot number is required for lot-tracked products'; end if;
      if coalesce(v_item->>'expiry_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'A valid expiry date is required for lot-tracked products'; end if;
      v_expiry_date:=(v_item->>'expiry_date')::date;
      if v_expiry_date<current_date then raise exception 'Cannot receive an already expired lot'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_order.tenant_id::text||':'||v_order.location_id::text||':'||v_line.product_id::text,0));
      insert into public.stock_lots(tenant_id,product_id,location_id,lot_code,expiry_date,created_by)
      values(v_order.tenant_id,v_line.product_id,v_order.location_id,v_lot_code,v_expiry_date,auth.uid())
      on conflict(tenant_id,product_id,location_id,lot_code) do update set expiry_date=excluded.expiry_date
        where public.stock_lots.expiry_date=excluded.expiry_date returning id into v_lot_id;
      if v_lot_id is null then raise exception 'Lot code already exists with a different expiry date'; end if;
      insert into public.stock_movements(tenant_id,location_id,product_id,lot_id,movement_type,quantity_delta,reference,note,created_by)
      values(v_order.tenant_id,v_order.location_id,v_line.product_id,v_lot_id,'receipt',v_quantity,v_order.order_number,'Réception '||v_receipt_number,auth.uid());
    else
      if coalesce(v_item->>'lot_code','')<>'' or coalesce(v_item->>'expiry_date','')<>'' then raise exception 'Lot fields are only accepted for products with lot tracking enabled'; end if;
      insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
      values(v_order.tenant_id,v_order.location_id,v_line.product_id,'receipt',v_quantity,v_order.order_number,'Réception '||v_receipt_number,auth.uid());
    end if;
    update public.purchase_order_items set received_quantity=received_quantity+v_quantity where id=v_line.id and tenant_id=v_order.tenant_id;
    v_received_total:=v_received_total+v_quantity;
  end loop;
  if v_count=0 or v_received_total<=0 then raise exception 'Empty receipt'; end if;
  if exists(select 1 from public.purchase_order_items i where i.tenant_id=v_order.tenant_id and i.purchase_order_id=v_order.id and i.received_quantity<i.quantity) then
    update public.purchase_orders set status='partially_received',updated_at=now() where id=v_order.id and tenant_id=v_order.tenant_id;
  else update public.purchase_orders set status='received',updated_at=now() where id=v_order.id and tenant_id=v_order.tenant_id; end if;
  return v_receipt_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.receive_stock_lot(p_tenant_id uuid, p_product_id uuid, p_location_id uuid, p_lot_code text, p_expiry_date date, p_quantity numeric, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_lot_id uuid; v_current numeric(14,3);
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'stock_manage') then raise exception 'Insufficient permissions'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000 then raise exception 'Invalid lot quantity'; end if;
  if p_lot_code is null or length(trim(p_lot_code)) not between 1 and 80 then raise exception 'Invalid lot code'; end if;
  if p_expiry_date is null then raise exception 'Expiry date is required'; end if;
  if not exists(select 1 from public.products p where p.id=p_product_id and p.tenant_id=p_tenant_id and p.is_active and p.track_stock) then
    raise exception 'Stock-tracked product unavailable';
  end if;
  if not exists(select 1 from public.stock_locations l where l.id=p_location_id and l.tenant_id=p_tenant_id and l.is_active) then
    raise exception 'Stock location unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || p_location_id::text || ':' || p_product_id::text,0));

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
$function$
;

CREATE OR REPLACE FUNCTION public.receive_stock_transfer(p_transfer_id uuid, p_client_receipt_id uuid, p_items jsonb, p_notes text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_transfer public.stock_transfers%rowtype; v_item public.stock_transfer_items%rowtype; v_input jsonb;
  v_item_id uuid; v_quantity numeric(14,3); v_remaining numeric(14,3); v_to_allocate numeric(14,3);
  v_take numeric(14,3); v_receipt_id uuid; v_receipt_number text; v_count integer:=0;
  v_product public.products%rowtype; v_allocation record; v_source_lot public.stock_lots%rowtype; v_destination_lot_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_transfer from public.stock_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if not private.has_tenant_permission(v_transfer.tenant_id,'stock_manage') then raise exception 'Permission denied to receive this transfer'; end if;
  if p_client_receipt_id is null then raise exception 'Receipt idempotency key is required'; end if;
  select id into v_receipt_id from public.stock_transfer_receipts where tenant_id=v_transfer.tenant_id and client_receipt_id=p_client_receipt_id;
  if found then return v_receipt_id; end if;
  if v_transfer.status not in ('shipped','partially_received') then raise exception 'Only dispatched transfers can be received'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then raise exception 'Receipt must contain between 1 and 100 lines'; end if;
  v_receipt_id:=gen_random_uuid();
  v_receipt_number:='TRR-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_receipt_id::text,'-',''),1,8));
  insert into public.stock_transfer_receipts(id,tenant_id,transfer_id,receipt_number,client_receipt_id,received_by,notes)
  values(v_receipt_id,v_transfer.tenant_id,v_transfer.id,v_receipt_number,p_client_receipt_id,auth.uid(),left(trim(coalesce(p_notes,'')),1000));
  for v_input in select value from jsonb_array_elements(p_items) loop
    v_count:=v_count+1;
    if coalesce(v_input->>'transfer_item_id','') !~* '^[0-9a-f-]{36}$' then raise exception 'Invalid transfer line identifier'; end if;
    v_item_id:=(v_input->>'transfer_item_id')::uuid; v_quantity:=(v_input->>'quantity')::numeric;
    select * into v_item from public.stock_transfer_items where id=v_item_id and tenant_id=v_transfer.tenant_id and transfer_id=v_transfer.id for update;
    if not found then raise exception 'Transfer line not found'; end if;
    v_remaining:=v_item.quantity-v_item.received_quantity;
    if v_quantity is null or v_quantity<=0 or v_quantity>v_remaining then raise exception 'Received quantity exceeds remaining quantity for product %',v_item.product_id; end if;
    select * into v_product from public.products where id=v_item.product_id and tenant_id=v_transfer.tenant_id;
    if not found then raise exception 'Product not found'; end if;
    insert into public.stock_transfer_receipt_items(tenant_id,receipt_id,transfer_item_id,product_id,quantity)
    values(v_transfer.tenant_id,v_receipt_id,v_item.id,v_item.product_id,v_quantity);
    if v_product.track_lots then
      v_to_allocate:=v_quantity;
      for v_allocation in select a.id,a.source_lot_id,a.shipped_quantity,a.received_quantity,a.destination_lot_id
        from public.stock_transfer_lot_allocations a join public.stock_lots sl on sl.id=a.source_lot_id and sl.tenant_id=a.tenant_id
        where a.tenant_id=v_transfer.tenant_id and a.transfer_item_id=v_item.id and a.received_quantity<a.shipped_quantity
        order by sl.expiry_date,sl.received_at,a.id for update of a loop
        exit when v_to_allocate<=0;
        v_take:=least(v_to_allocate,v_allocation.shipped_quantity-v_allocation.received_quantity);
        select * into v_source_lot from public.stock_lots where id=v_allocation.source_lot_id and tenant_id=v_transfer.tenant_id;
        if v_allocation.destination_lot_id is null then
          insert into public.stock_lots(tenant_id,product_id,location_id,lot_code,expiry_date,created_by)
          values(v_transfer.tenant_id,v_item.product_id,v_transfer.destination_location_id,v_source_lot.lot_code,v_source_lot.expiry_date,auth.uid())
          on conflict(tenant_id,product_id,location_id,lot_code) do update set expiry_date=excluded.expiry_date
            where public.stock_lots.expiry_date=excluded.expiry_date returning id into v_destination_lot_id;
          if v_destination_lot_id is null then raise exception 'Destination lot code conflicts with a different expiry date'; end if;
          update public.stock_transfer_lot_allocations set destination_lot_id=v_destination_lot_id where id=v_allocation.id and tenant_id=v_transfer.tenant_id;
        else v_destination_lot_id:=v_allocation.destination_lot_id; end if;
        insert into public.stock_movements(tenant_id,location_id,product_id,lot_id,movement_type,quantity_delta,reference,note,created_by)
        values(v_transfer.tenant_id,v_transfer.destination_location_id,v_item.product_id,v_destination_lot_id,'transfer_in',
          v_take,v_receipt_number,'Réception du lot '||v_source_lot.lot_code||' du transfert '||v_transfer.transfer_number,auth.uid());
        update public.stock_transfer_lot_allocations set received_quantity=received_quantity+v_take where id=v_allocation.id and tenant_id=v_transfer.tenant_id;
        v_to_allocate:=v_to_allocate-v_take;
      end loop;
      if v_to_allocate>0 then raise exception 'Lot allocation is missing for shipped quantity'; end if;
    else
      insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
      values(v_transfer.tenant_id,v_transfer.destination_location_id,v_item.product_id,'transfer_in',v_quantity,v_receipt_number,
        'Réception du transfert '||v_transfer.transfer_number,auth.uid());
    end if;
    update public.stock_transfer_items set received_quantity=received_quantity+v_quantity where id=v_item.id and tenant_id=v_transfer.tenant_id;
  end loop;
  if v_count=0 then raise exception 'Empty transfer receipt'; end if;
  if exists(select 1 from public.stock_transfer_items where tenant_id=v_transfer.tenant_id and transfer_id=v_transfer.id and received_quantity<quantity) then
    update public.stock_transfers set status='partially_received',received_by=auth.uid(),received_at=now() where id=v_transfer.id and tenant_id=v_transfer.tenant_id;
  else update public.stock_transfers set status='received',received_by=auth.uid(),received_at=now() where id=v_transfer.id and tenant_id=v_transfer.tenant_id; end if;
  return v_receipt_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_supplier_invoice_payment(p_invoice_id uuid, p_payment_account_id uuid, p_amount numeric, p_paid_at date, p_reference text DEFAULT ''::text, p_cash_session_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  v_existing_payment public.supplier_invoice_payments%rowtype;
begin
  if auth.uid() is null or p_amount is null or p_amount <= 0
    or p_amount > 999999999999 or p_paid_at is null or p_idempotency_key is null
    or length(trim(coalesce(p_reference,''))) > 100 then
    raise exception 'Invalid supplier payment'; end if;

  select * into v_invoice from public.supplier_invoices
    where id=p_invoice_id for update;
  if not found or not private.has_tenant_permission(v_invoice.tenant_id,'purchasing_manage') then raise exception 'Permission denied or invoice unavailable'; end if;

  select * into v_existing_payment from public.supplier_invoice_payments
    where tenant_id=v_invoice.tenant_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing_payment.invoice_id <> v_invoice.id
      or v_existing_payment.payment_account_id <> p_payment_account_id
      or v_existing_payment.cash_session_id is distinct from p_cash_session_id
      or v_existing_payment.amount <> round(p_amount,2)
      or v_existing_payment.paid_at <> p_paid_at
      or v_existing_payment.reference <> left(trim(coalesce(p_reference,'')),100) then
      raise exception 'Idempotency key was already used for a different payment'; end if;
    return v_existing_payment.id;
  end if;

  v_remaining := round(v_invoice.amount - v_invoice.paid_amount,2);
  if round(p_amount,2) > v_remaining then
    raise exception 'Payment exceeds outstanding supplier balance'; end if;

  select account_kind into v_payment_account_kind from public.accounting_accounts
    where id=p_payment_account_id and tenant_id=v_invoice.tenant_id
      and is_active and account_kind in ('cash','bank');
  if v_payment_account_kind is null then raise exception 'Invalid payment account'; end if;

  if v_payment_account_kind='cash' then
    if p_cash_session_id is null then raise exception 'An open cash session is required for cash payments'; end if;
    select * into v_cash_session from public.cash_sessions
      where id=p_cash_session_id and tenant_id=v_invoice.tenant_id for update;
    if not found or v_cash_session.status <> 'open' then raise exception 'Cash session is not open'; end if;
    if v_cash_session.opened_by <> auth.uid() and not private.has_tenant_permission(v_invoice.tenant_id,'cash_manage') then raise exception 'Permission denied for this cash session'; end if;
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
    id,tenant_id,invoice_id,payment_account_id,amount,paid_at,reference,cash_session_id,idempotency_key,created_by
  ) values (
    v_payment_id,v_invoice.tenant_id,v_invoice.id,p_payment_account_id,
    round(p_amount,2),p_paid_at,left(trim(coalesce(p_reference,'')),100),p_cash_session_id,p_idempotency_key,auth.uid()
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
$function$
;

CREATE OR REPLACE FUNCTION public.register_sale_return(p_tenant_id uuid, p_sale_item_id uuid, p_quantity numeric, p_refund_method text, p_reason text, p_client_return_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_item public.sale_items%rowtype;
  v_sale public.sales%rowtype;
  v_product public.products%rowtype;
  v_already_returned numeric(14,3);
  v_returnable numeric(14,3);
  v_refund numeric(14,2);
  v_subtotal numeric(14,2);
  v_tax numeric(14,2);
  v_return_id uuid;
  v_lot_id uuid;
  v_journal_id uuid := gen_random_uuid();
  v_journal_number text;
  v_sales_account uuid;
  v_vat_account uuid;
  v_payment_account uuid;
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'sales_manage') then
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

  select * into v_product from public.products where id=v_item.product_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Product not found'; end if;
  if v_product.track_lots then
    insert into public.stock_lots(tenant_id,product_id,location_id,lot_code,expiry_date,is_quarantined,created_by)
    values(p_tenant_id,v_item.product_id,v_sale.location_id,
      'RETURN-'||upper(substr(replace(v_return_id::text,'-',''),1,16)),current_date,true,auth.uid())
    returning id into v_lot_id;
    insert into public.stock_movements(
      tenant_id,location_id,product_id,lot_id,movement_type,quantity_delta,reference,note,created_by
    ) values (
      p_tenant_id,v_sale.location_id,v_item.product_id,v_lot_id,'sale_return',p_quantity,
      'RETURN-'||v_return_id::text,'Retour client en quarantaine : '||trim(p_reason),auth.uid()
    );
  else
    insert into public.stock_movements(
      tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by
    ) values (
      p_tenant_id,v_sale.location_id,v_item.product_id,'sale_return',p_quantity,
      'RETURN-'||v_return_id::text,'Retour client : '||trim(p_reason),auth.uid()
    );
  end if;

  perform public.seed_default_accounting_chart(p_tenant_id);
  insert into public.accounting_accounts(tenant_id,code,name,account_class,account_kind)
  values(p_tenant_id,'419000','Clients créditeurs - avoirs','liability','customer')
  on conflict(tenant_id,code) do nothing;
  select id into v_sales_account from public.accounting_accounts where tenant_id=p_tenant_id and code='701000';
  select id into v_vat_account from public.accounting_accounts where tenant_id=p_tenant_id and code='443000';
  if p_refund_method='cash' then
    select id into v_payment_account from public.accounting_accounts where tenant_id=p_tenant_id and code='571000';
  elsif p_refund_method='credit_note' then
    select id into v_payment_account from public.accounting_accounts where tenant_id=p_tenant_id and code='419000';
  else
    select id into v_payment_account from public.accounting_accounts where tenant_id=p_tenant_id and code='521000';
  end if;
  v_subtotal := round(p_quantity * v_item.unit_price,2);
  v_tax := v_refund - v_subtotal;
  v_journal_number := 'RT-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(v_journal_id::text,'-',''),1,8));
  insert into public.journal_entries(id,tenant_id,entry_number,entry_date,description,source_type,source_id,created_by)
  values(v_journal_id,p_tenant_id,v_journal_number,current_date,'Retour vente '||left(v_sale.id::text,8),'sale',v_return_id,auth.uid());
  if v_subtotal > 0 then
    insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit)
    values(p_tenant_id,v_journal_id,v_sales_account,'Annulation partielle de vente',v_subtotal,0);
  end if;
  if v_tax > 0 then
    insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit)
    values(p_tenant_id,v_journal_id,v_vat_account,'Annulation TVA vente',v_tax,0);
  end if;
  insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit)
  values(p_tenant_id,v_journal_id,v_payment_account,
    case when p_refund_method='credit_note' then 'Avoir client émis' else 'Remboursement client' end,
    0,v_refund);

  return v_return_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_customer_active(p_tenant_id uuid, p_customer_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'sales_manage') then
    raise exception 'Permission denied to change customer status';
  end if;
  update public.customers
     set is_active=coalesce(p_active,false), updated_at=now()
   where id=p_customer_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Customer not found'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_inventory_count_line(p_inventory_count_id uuid, p_product_id uuid, p_counted_quantity numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  if not private.has_tenant_permission(v_count.tenant_id,'stock_manage') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_sale_customer(p_tenant_id uuid, p_sale_id uuid, p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'sales_manage') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.ship_stock_transfer(p_transfer_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_transfer public.stock_transfers%rowtype; v_item public.stock_transfer_items%rowtype;
  v_available numeric(14,3); v_movement_id uuid; v_lot_row record;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_transfer from public.stock_transfers where id=p_transfer_id for update;
  if not found or v_transfer.status<>'draft' then raise exception 'Transfer is unavailable or already dispatched'; end if;
  if not private.has_tenant_permission(v_transfer.tenant_id,'stock_manage') then raise exception 'Permission denied to dispatch this transfer'; end if;
  for v_item in select * from public.stock_transfer_items where tenant_id=v_transfer.tenant_id and transfer_id=v_transfer.id order by product_id for update loop
    perform pg_advisory_xact_lock(hashtextextended(v_transfer.tenant_id::text||':'||v_transfer.source_location_id::text||':'||v_item.product_id::text,0));
    select coalesce(sum(quantity_delta),0)::numeric(14,3) into v_available from public.stock_movements
      where tenant_id=v_transfer.tenant_id and location_id=v_transfer.source_location_id and product_id=v_item.product_id;
    if v_available<v_item.quantity then raise exception 'Insufficient stock at dispatch for product %. Available: %',v_item.product_id,v_available; end if;
    insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
    values(v_transfer.tenant_id,v_transfer.source_location_id,v_item.product_id,'transfer_out',-v_item.quantity,v_transfer.transfer_number,
      'Expédition vers '||v_transfer.destination_location_id::text,auth.uid()) returning id into v_movement_id;
    for v_lot_row in select lm.lot_id,abs(lm.quantity_delta)::numeric(14,3) as allocated
      from public.stock_lot_movements lm where lm.tenant_id=v_transfer.tenant_id and lm.stock_movement_id=v_movement_id and lm.quantity_delta<0
      order by lm.lot_id loop
      insert into public.stock_transfer_lot_allocations(tenant_id,transfer_item_id,source_lot_id,shipped_quantity)
      values(v_transfer.tenant_id,v_item.id,v_lot_row.lot_id,v_lot_row.allocated);
    end loop;
  end loop;
  update public.stock_transfers set status='shipped',shipped_by=auth.uid(),shipped_at=now() where id=v_transfer.id and tenant_id=v_transfer.tenant_id;
  return v_transfer.id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.update_customer(p_tenant_id uuid, p_customer_id uuid, p_name text, p_phone text DEFAULT ''::text, p_email text DEFAULT ''::text, p_address text DEFAULT ''::text, p_notes text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'sales_manage') then
    raise exception 'Permission denied to update customer';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 160
     or length(coalesce(p_phone,'')) > 40
     or length(coalesce(p_email,'')) > 254
     or length(coalesce(p_address,'')) > 500
     or length(coalesce(p_notes,'')) > 1000 then
    raise exception 'Invalid customer information';
  end if;
  update public.customers
     set name=trim(p_name),
         phone=trim(coalesce(p_phone,'')),
         email=lower(trim(coalesce(p_email,''))),
         address=trim(coalesce(p_address,'')),
         notes=trim(coalesce(p_notes,'')),
         updated_at=now()
   where id=p_customer_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Customer not found'; end if;
end;
$function$
;
