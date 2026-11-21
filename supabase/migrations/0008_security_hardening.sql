-- Security hardening for exposed SECURITY DEFINER routines.
-- Trigger-only functions must never be callable through the public Data API.
revoke all on function public.accounting_post_completed_sale() from public, anon, authenticated;
revoke all on function public.accounting_post_purchase_receipt_item() from public, anon, authenticated;
revoke all on function public.guard_stock_movement() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.seed_default_accounting_chart(uuid) from public, anon, authenticated;

-- Keep tenant membership helpers available to authenticated RLS policies only.
revoke all on function public.is_tenant_member(uuid) from public, anon, authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
revoke all on function public.has_tenant_role(uuid, public.tenant_role[]) from public, anon, authenticated;
grant execute on function public.has_tenant_role(uuid, public.tenant_role[]) to authenticated;

-- Explicitly allow only application RPCs to authenticated users.
revoke all on function public.create_tenant(text, text) from public, anon, authenticated;
grant execute on function public.create_tenant(text, text) to authenticated;
revoke all on function public.open_cash_session(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.open_cash_session(uuid, uuid, numeric) to authenticated;
revoke all on function public.close_cash_session(uuid, numeric) from public, anon, authenticated;
grant execute on function public.close_cash_session(uuid, numeric) to authenticated;
revoke all on function public.create_cash_movement(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.create_cash_movement(uuid, text, numeric, text) to authenticated;
revoke all on function public.create_purchase_order(uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_purchase_order(uuid, uuid, uuid, jsonb, text) to authenticated;
revoke all on function public.receive_purchase_order(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.receive_purchase_order(uuid, jsonb, text) to authenticated;
revoke all on function public.finalize_sale(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_sale(uuid, uuid, uuid, uuid, jsonb, jsonb) to authenticated;
revoke all on function public.ensure_accounting_chart(uuid) from public, anon, authenticated;
grant execute on function public.ensure_accounting_chart(uuid) to authenticated;
revoke all on function public.post_manual_journal_entry(uuid, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.post_manual_journal_entry(uuid, date, text, jsonb) to authenticated;
revoke all on function public.create_expense(uuid, date, text, numeric, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_expense(uuid, date, text, numeric, uuid, uuid, text) to authenticated;

-- Immutable trigger functions use a fixed search_path to avoid object-shadowing attacks.
alter function public.prevent_stock_movement_mutation() set search_path = public;
alter function public.guard_sale_header() set search_path = public;
alter function public.prevent_sale_line_mutation() set search_path = public;
alter function public.prevent_purchase_receipt_mutation() set search_path = public;
alter function public.prevent_cash_movement_mutation() set search_path = public;
alter function public.prevent_accounting_mutation() set search_path = public;
