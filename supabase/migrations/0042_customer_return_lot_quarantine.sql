-- iDIABA Sprint 42: customer returns of lot-tracked goods enter quarantine, never sellable stock.
alter table public.stock_lots
  add column if not exists is_quarantined boolean not null default false;

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
      and l.expiry_date >= current_date and not l.is_quarantined
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
$$;
revoke all on function public.register_sale_return(uuid,uuid,numeric,text,text,uuid) from public,anon;
grant execute on function public.register_sale_return(uuid,uuid,numeric,text,text,uuid) to authenticated;
