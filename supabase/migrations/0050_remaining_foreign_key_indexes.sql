-- Add covering indexes for the remaining foreign keys reported by Supabase.
-- These indexes are additive and do not modify existing commerce data.
create index if not exists idx_products_parent_product_id
  on public.products (parent_product_id);

create index if not exists idx_stock_transfers_created_by
  on public.stock_transfers (created_by);
create index if not exists idx_stock_transfers_received_by
  on public.stock_transfers (received_by);
create index if not exists idx_stock_transfers_shipped_by
  on public.stock_transfers (shipped_by);

create index if not exists idx_supplier_invoice_payments_created_by
  on public.supplier_invoice_payments (created_by);
create index if not exists idx_stock_lots_created_by
  on public.stock_lots (created_by);
create index if not exists idx_stock_transfer_receipts_received_by
  on public.stock_transfer_receipts (received_by);
create index if not exists idx_supplier_invoices_created_by
  on public.supplier_invoices (created_by);

create index if not exists idx_product_prices_product_id
  on public.product_prices (product_id);
create index if not exists idx_product_recipe_items_ingredient_product_id
  on public.product_recipe_items (ingredient_product_id);
create index if not exists idx_product_recipes_product_id
  on public.product_recipes (product_id);
create index if not exists idx_stock_location_memberships_assigned_by
  on public.stock_location_memberships (assigned_by);
create index if not exists idx_stock_reorder_thresholds_created_by
  on public.stock_reorder_thresholds (created_by);
