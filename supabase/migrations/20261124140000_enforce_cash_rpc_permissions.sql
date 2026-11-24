-- Add cash-specific management permission and enforce it in POS RPCs.
alter table public.tenant_role_profiles drop constraint if exists tenant_role_profiles_permissions_valid;
alter table public.tenant_role_profiles add constraint tenant_role_profiles_permissions_valid
check (permissions <@ array[
  'cash_register','cash_manage','sales_read','sales_manage',
  'products_read','products_manage','stock_read','stock_manage',
  'purchasing_read','purchasing_manage','reports_read',
  'accounting_read','accounting_manage','team_manage',
  'settings_manage','audit_read'
]::text[]);

update public.tenant_role_profiles
set permissions = array(select distinct x from unnest(permissions || array['cash_manage']::text[]) as t(x))
where 'manager' = any(allowed_roles) and not ('cash_manage' = any(permissions));

CREATE OR REPLACE FUNCTION private.has_tenant_permission(target_tenant uuid, required_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select
    required_permission = any(array[
      'cash_register','cash_manage','sales_read','sales_manage',
      'products_read','products_manage','stock_read','stock_manage',
      'purchasing_read','purchasing_manage','reports_read',
      'accounting_read','accounting_manage','team_manage',
      'settings_manage','audit_read'
    ]::text[])
    and exists (
      select 1
      from public.tenant_memberships m
      left join public.tenant_role_profiles p
        on p.id = m.custom_role_profile_id
       and p.tenant_id = m.tenant_id
      where m.tenant_id = target_tenant
        and m.user_id = auth.uid()
        and (
          m.role in ('owner','admin')
          or (
            m.custom_role_profile_id is not null
            and (
              required_permission = any(p.permissions)
              or (
                cardinality(p.permissions) = 0
                and (
                  (required_permission = 'cash_register' and 'cashier' = any(p.allowed_roles))
                  or (required_permission in ('sales_read','sales_manage') and p.allowed_roles && array['manager','cashier','accountant','viewer']::public.tenant_role[])
                  or (required_permission in ('products_read','products_manage','stock_read','stock_manage') and p.allowed_roles && array['manager','stock','viewer']::public.tenant_role[])
                  or (required_permission in ('purchasing_read','purchasing_manage') and p.allowed_roles && array['manager','stock','accountant','viewer']::public.tenant_role[])
                  or (required_permission in ('reports_read','accounting_read') and p.allowed_roles && array['manager','accountant','viewer']::public.tenant_role[])
                  or (required_permission = 'accounting_manage' and p.allowed_roles && array['manager','accountant']::public.tenant_role[])
                  or (required_permission in ('team_manage','settings_manage','audit_read','cash_manage') and 'manager' = any(p.allowed_roles))
                )
              )
            )
          )
          or (
            m.custom_role_profile_id is null
            and (
              (required_permission = 'cash_register' and m.role = 'cashier')
              or (required_permission in ('sales_read','sales_manage') and m.role in ('manager','cashier','accountant','viewer'))
              or (required_permission in ('products_read','products_manage','stock_read','stock_manage') and m.role in ('manager','stock','viewer'))
              or (required_permission in ('purchasing_read','purchasing_manage') and m.role in ('manager','stock','accountant','viewer'))
              or (required_permission in ('reports_read','accounting_read') and m.role in ('manager','accountant','viewer'))
              or (required_permission = 'accounting_manage' and m.role in ('manager','accountant'))
              or (required_permission in ('team_manage','settings_manage','audit_read','cash_manage') and m.role = 'manager')
            )
          )
        )
    );
$function$;


CREATE OR REPLACE FUNCTION public.open_cash_session(p_tenant_id uuid, p_location_id uuid, p_opening_cash numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare new_session_id uuid;
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'cash_register') then
    raise exception 'Permission denied to open a cash session';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 then raise exception 'Opening cash must be non-negative'; end if;
  if not exists (select 1 from public.stock_locations l where l.id=p_location_id and l.tenant_id=p_tenant_id and l.is_active=true) then
    raise exception 'Invalid or inactive stock location';
  end if;
  insert into public.cash_sessions(tenant_id,location_id,opened_by,opening_cash)
    values(p_tenant_id,p_location_id,auth.uid(),round(p_opening_cash,2))
    returning id into new_session_id;
  return new_session_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.close_cash_session(p_session_id uuid, p_closing_cash numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
     and not private.has_tenant_permission(s.tenant_id,'cash_manage') then
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
$function$;


CREATE OR REPLACE FUNCTION public.create_cash_movement(p_session_id uuid, p_movement_type text, p_amount numeric, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  if not private.has_tenant_permission(s.tenant_id,'cash_manage') then
    raise exception 'Permission denied to record cash movement';
  end if;
  if s.opened_by <> auth.uid()
     and not private.has_tenant_permission(s.tenant_id,'cash_manage') then
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
$function$;


CREATE OR REPLACE FUNCTION public.finalize_sale(p_tenant_id uuid, p_location_id uuid, p_cash_session_id uuid, p_client_sale_id uuid, p_items jsonb, p_payments jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_sale_id uuid;
  v_session public.cash_sessions%rowtype;
  v_item jsonb;
  v_payment jsonb;
  v_product public.products%rowtype;
  v_qty numeric(14,3);
  v_subtotal numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_line_subtotal numeric(14,2);
  v_line_tax numeric(14,2);
  v_payment_total numeric(14,2) := 0;
  v_method text;
  v_amount numeric(14,2);
  v_reference text;
begin
  if auth.uid() is null or not private.has_tenant_permission(p_tenant_id,'cash_register') then
    raise exception 'Permission denied to checkout';
  end if;
  if p_client_sale_id is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0
     or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments)=0 then
    raise exception 'A sale requires items and payments';
  end if;

  select * into v_session from public.cash_sessions
    where id=p_cash_session_id and tenant_id=p_tenant_id and location_id=p_location_id
    for update;
  if not found or v_session.status <> 'open' then raise exception 'Cash session is not open for this location'; end if;
  if v_session.opened_by <> auth.uid() and not private.has_tenant_permission(p_tenant_id,'cash_manage') then
    raise exception 'This cash session belongs to another cashier';
  end if;

  insert into public.sales(tenant_id,location_id,cash_session_id,cashier_id,client_sale_id)
    values(p_tenant_id,p_location_id,p_cash_session_id,auth.uid(),p_client_sale_id)
    on conflict (tenant_id,client_sale_id) do nothing returning id into v_sale_id;
  if v_sale_id is null then
    select id into v_sale_id from public.sales where tenant_id=p_tenant_id and client_sale_id=p_client_sale_id;
    return v_sale_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'product_id','') !~* '^[0-9a-f-]{36}$' then raise exception 'Invalid product identifier'; end if;
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then raise exception 'Invalid product quantity'; end if;
    select * into v_product from public.products
      where id=(v_item->>'product_id')::uuid and tenant_id=p_tenant_id and is_active=true;
    if not found then raise exception 'Product not found or inactive'; end if;

    v_line_subtotal := round(v_qty * v_product.sale_price,2);
    v_line_tax := round(v_line_subtotal * v_product.tax_rate / 100,2);
    insert into public.sale_items(tenant_id,sale_id,product_id,product_name,sku,quantity,unit_price,tax_rate,line_subtotal,line_tax,line_total)
      values(p_tenant_id,v_sale_id,v_product.id,v_product.name,v_product.sku,v_qty,v_product.sale_price,v_product.tax_rate,
             v_line_subtotal,v_line_tax,v_line_subtotal+v_line_tax);
    if v_product.track_stock then
      insert into public.stock_movements(tenant_id,location_id,product_id,movement_type,quantity_delta,reference,note,created_by)
        values(p_tenant_id,p_location_id,v_product.id,'sale',-v_qty,'SALE-'||v_sale_id::text,'Vente caisse',auth.uid());
    end if;
    v_subtotal := v_subtotal + v_line_subtotal;
    v_tax := v_tax + v_line_tax;
  end loop;

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    v_method := v_payment->>'method';
    v_amount := (v_payment->>'amount')::numeric;
    v_reference := left(trim(coalesce(v_payment->>'reference','')),160);
    if v_method not in ('cash','mobile_money','card','bank_transfer','wave','orange_money') or v_amount is null or v_amount <= 0 then
      raise exception 'Invalid payment line';
    end if;
    if v_method in ('wave','orange_money') and length(v_reference) < 4 then
      raise exception 'Mobile money transaction reference is required';
    end if;
    v_payment_total := v_payment_total + round(v_amount,2);
    insert into public.sale_payments(tenant_id,sale_id,payment_method,amount,payment_reference)
      values(p_tenant_id,v_sale_id,v_method,round(v_amount,2),nullif(v_reference,''));
  end loop;

  if round(v_payment_total,2) <> round(v_subtotal+v_tax,2) then
    raise exception 'Payment total must exactly match the sale total';
  end if;
  update public.sales set subtotal=v_subtotal,tax_total=v_tax,total=v_subtotal+v_tax,
    status='completed',completed_at=now() where id=v_sale_id and tenant_id=p_tenant_id;
  return v_sale_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_cash_session_reconciliation(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_session public.cash_sessions%rowtype;
  v_cash_sales numeric(14,2);
  v_cash_in numeric(14,2);
  v_cash_out numeric(14,2);
  v_payments jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  select * into v_session
  from public.cash_sessions
  where id = p_session_id;

  if not found or v_session.status <> 'open' then
    raise exception 'Session de caisse ouverte introuvable';
  end if;

  if not public.is_tenant_member(v_session.tenant_id) then
    raise exception 'Accès refusé à cette entreprise';
  end if;

  if v_session.opened_by <> auth.uid()
     and not private.has_tenant_permission(v_session.tenant_id,'cash_manage') then
    raise exception 'Accès refusé à cette session de caisse';
  end if;

  select coalesce(sum(sp.amount), 0)::numeric(14,2)
  into v_cash_sales
  from public.sale_payments sp
  join public.sales s
    on s.id = sp.sale_id and s.tenant_id = sp.tenant_id
  where sp.tenant_id = v_session.tenant_id
    and s.cash_session_id = v_session.id
    and s.status = 'completed'
    and sp.payment_method = 'cash';

  select coalesce(sum(cm.amount), 0)::numeric(14,2)
  into v_cash_in
  from public.cash_movements cm
  where cm.tenant_id = v_session.tenant_id
    and cm.cash_session_id = v_session.id
    and cm.movement_type = 'cash_in';

  select coalesce(sum(cm.amount), 0)::numeric(14,2)
  into v_cash_out
  from public.cash_movements cm
  where cm.tenant_id = v_session.tenant_id
    and cm.cash_session_id = v_session.id
    and cm.movement_type = 'cash_out';

  select coalesce(jsonb_agg(jsonb_build_object(
    'payment_method', grouped.payment_method,
    'amount', grouped.amount,
    'payments_count', grouped.payments_count
  ) order by grouped.amount desc), '[]'::jsonb)
  into v_payments
  from (
    select sp.payment_method,
      sum(sp.amount)::numeric(14,2) as amount,
      count(sp.id) as payments_count
    from public.sale_payments sp
    join public.sales s
      on s.id = sp.sale_id and s.tenant_id = sp.tenant_id
    where sp.tenant_id = v_session.tenant_id
      and s.cash_session_id = v_session.id
      and s.status = 'completed'
    group by sp.payment_method
  ) grouped;

  return jsonb_build_object(
    'cash_sales', v_cash_sales,
    'cash_in', v_cash_in,
    'cash_out', v_cash_out,
    'expected_cash', round(v_session.opening_cash + v_cash_sales + v_cash_in - v_cash_out, 2),
    'payments', v_payments
  );
end;
$function$;

