-- Resolve payment table advisor findings without widening data access.
create index if not exists subscription_payments_created_by_idx
  on public.subscription_payments(created_by);
create index if not exists subscription_payments_tenant_request_idx
  on public.subscription_payments(tenant_id,subscription_request_id);

-- Explicit deny policy documents that webhook event rows are private to trusted
-- SECURITY DEFINER processing functions; browser roles receive no table grants.
create policy "deny direct access to payment webhook events"
  on public.payment_webhook_events
  for all to anon,authenticated
  using (false)
  with check (false);
