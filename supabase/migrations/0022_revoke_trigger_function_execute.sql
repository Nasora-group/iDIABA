-- Trigger functions are invoked by PostgreSQL triggers, not directly through PostgREST.
-- Prevent callers from invoking this SECURITY DEFINER trigger function as an RPC.
revoke all on function public.update_product_weighted_cost_from_receipt() from public, anon, authenticated;
