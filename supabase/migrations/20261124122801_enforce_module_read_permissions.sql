-- Enforce module-level read permissions in RLS while preserving existing row/location filters.
do $$
declare
  r record;
  permission_key text;
  permission_expr text;
begin
  for r in
    select schemaname, tablename, policyname, qual
    from pg_policies
    where schemaname = 'public'
      and cmd = 'SELECT'
      and tablename in (
        'accounting_accounts','audit_logs','cash_movements','cash_sessions',
        'customers','expenses','inventory_count_items','inventory_counts',
        'journal_entries','journal_lines','price_lists','product_categories',
        'product_prices','product_recipe_items','product_recipes','products',
        'purchase_order_items','purchase_orders','purchase_receipt_items',
        'purchase_receipts','sale_items','sale_payments','sale_return_items',
        'sale_returns','sales','stock_locations','stock_lot_movements',
        'stock_lots','stock_movements','stock_reorder_thresholds',
        'stock_transfer_items','stock_transfer_lot_allocations',
        'stock_transfer_receipt_items','stock_transfer_receipts',
        'stock_transfers','supplier_invoice_payments','supplier_invoices','suppliers'
      )
  loop
    permission_key := case r.tablename
      when 'accounting_accounts' then 'accounting_read'
      when 'audit_logs' then 'audit_read'
      when 'cash_movements' then 'cash_register'
      when 'cash_sessions' then 'cash_register'
      when 'customers' then 'sales_read'
      when 'expenses' then 'accounting_read'
      when 'inventory_count_items' then 'stock_read'
      when 'inventory_counts' then 'stock_read'
      when 'journal_entries' then 'accounting_read'
      when 'journal_lines' then 'accounting_read'
      when 'price_lists' then 'products_read'
      when 'product_categories' then 'products_read'
      when 'product_prices' then 'products_read'
      when 'product_recipe_items' then 'products_read'
      when 'product_recipes' then 'products_read'
      when 'products' then 'products_read'
      when 'purchase_order_items' then 'purchasing_read'
      when 'purchase_orders' then 'purchasing_read'
      when 'purchase_receipt_items' then 'purchasing_read'
      when 'purchase_receipts' then 'purchasing_read'
      when 'sale_items' then 'sales_read'
      when 'sale_payments' then 'sales_read'
      when 'sale_return_items' then 'sales_read'
      when 'sale_returns' then 'sales_read'
      when 'sales' then 'sales_read'
      when 'stock_locations' then 'stock_read'
      when 'stock_lot_movements' then 'stock_read'
      when 'stock_lots' then 'stock_read'
      when 'stock_movements' then 'stock_read'
      when 'stock_reorder_thresholds' then 'stock_read'
      when 'stock_transfer_items' then 'stock_read'
      when 'stock_transfer_lot_allocations' then 'stock_read'
      when 'stock_transfer_receipt_items' then 'stock_read'
      when 'stock_transfer_receipts' then 'stock_read'
      when 'stock_transfers' then 'stock_read'
      when 'supplier_invoice_payments' then 'purchasing_read'
      when 'supplier_invoices' then 'purchasing_read'
      when 'suppliers' then 'purchasing_read'
      else null
    end;

    if permission_key is null then
      continue;
    end if;

    if r.tablename = 'stock_locations' then
      permission_expr := '(private.has_tenant_permission(tenant_id, ''stock_read'') or private.has_tenant_permission(tenant_id, ''cash_register''))';
    else
      permission_expr := format('private.has_tenant_permission(tenant_id, %L)', permission_key);
    end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    if r.tablename = 'audit_logs' then
      execute format(
        'create policy %I on public.%I for select to authenticated using (%s)',
        r.policyname, r.tablename, permission_expr
      );
    else
      execute format(
        'create policy %I on public.%I for select to authenticated using (%s and (%s))',
        r.policyname, r.tablename, permission_expr, coalesce(r.qual, 'false')
      );
    end if;
  end loop;
end;
$$;
