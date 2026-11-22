-- The payment-method report is consumed with the signed-in tenant session.
-- Explicitly remove any default service_role grant on this RPC.
revoke all on function public.get_tenant_payment_method_report(uuid,timestamptz,timestamptz)
  from public, anon, service_role;
grant execute on function public.get_tenant_payment_method_report(uuid,timestamptz,timestamptz)
  to authenticated;
