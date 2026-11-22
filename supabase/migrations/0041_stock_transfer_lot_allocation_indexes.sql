-- iDIABA Sprint 41: cover both lot foreign keys for efficient transfer traceability lookups.
create index if not exists stock_transfer_lot_allocations_source_lot_idx
  on public.stock_transfer_lot_allocations(tenant_id, source_lot_id);
create index if not exists stock_transfer_lot_allocations_destination_lot_idx
  on public.stock_transfer_lot_allocations(tenant_id, destination_lot_id)
  where destination_lot_id is not null;
