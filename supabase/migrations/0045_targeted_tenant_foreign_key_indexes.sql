-- Targeted tenant-scoped indexes for stock, pricing and supplier-payment relations.
-- Existing indexes that already support tenant-scoped recipe and destination-lot
-- lookups are intentionally retained; no duplicate indexes are created.

create index if not exists product_prices_tenant_product_idx
  on public.product_prices (tenant_id, product_id);

create index if not exists stock_lot_movements_stock_movement_idx
  on public.stock_lot_movements (stock_movement_id);

create index if not exists stock_movements_tenant_lot_idx
  on public.stock_movements (tenant_id, lot_id);

create index if not exists stock_transfer_items_tenant_product_idx
  on public.stock_transfer_items (tenant_id, product_id);

create index if not exists stock_transfer_receipt_items_tenant_product_idx
  on public.stock_transfer_receipt_items (tenant_id, product_id);

create index if not exists stock_transfer_receipt_items_tenant_transfer_item_idx
  on public.stock_transfer_receipt_items (tenant_id, transfer_item_id);

create index if not exists stock_transfers_tenant_destination_location_idx
  on public.stock_transfers (tenant_id, destination_location_id);

create index if not exists stock_transfers_tenant_source_location_idx
  on public.stock_transfers (tenant_id, source_location_id);

create index if not exists supplier_invoice_payments_tenant_cash_session_idx
  on public.supplier_invoice_payments (tenant_id, cash_session_id);

create index if not exists supplier_invoice_payments_tenant_payment_account_idx
  on public.supplier_invoice_payments (tenant_id, payment_account_id);

create index if not exists supplier_invoices_tenant_purchase_order_idx
  on public.supplier_invoices (tenant_id, purchase_order_id);
