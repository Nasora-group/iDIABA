-- Pin SECURITY DEFINER function name resolution to trusted schemas.
-- All application objects referenced by these routines are schema-qualified.
-- This is a metadata-only hardening change; it does not modify business data.

alter function public.apply_stock_lot_movement()
  set search_path = pg_catalog, public;

alter function public.finalize_sale(uuid, uuid, uuid, uuid, jsonb, jsonb)
  set search_path = pg_catalog, public;

alter function public.receive_purchase_order(uuid, jsonb, text)
  set search_path = pg_catalog, public;

alter function public.receive_stock_lot(uuid, uuid, uuid, text, date, numeric, text)
  set search_path = pg_catalog, public;

alter function public.register_sale_return(uuid, uuid, numeric, text, text, uuid)
  set search_path = pg_catalog, public;
