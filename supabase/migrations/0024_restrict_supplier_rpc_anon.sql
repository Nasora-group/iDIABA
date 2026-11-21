-- Reconcile production hotfix: prevent anonymous execution of financial RPCs.
revoke execute on function public.create_supplier_invoice(uuid,uuid,uuid,text,date,date,numeric,text,numeric) from public, anon;
revoke execute on function public.record_supplier_invoice_payment(uuid,uuid,numeric,date,text,uuid,uuid) from public, anon;
grant execute on function public.create_supplier_invoice(uuid,uuid,uuid,text,date,date,numeric,text,numeric) to authenticated;
grant execute on function public.record_supplier_invoice_payment(uuid,uuid,numeric,date,text,uuid,uuid) to authenticated;
