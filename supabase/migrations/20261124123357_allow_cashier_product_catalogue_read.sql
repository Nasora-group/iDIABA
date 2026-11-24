-- Cashier checkout needs to read the sellable product catalogue.
drop policy if exists "members read products" on public.products;
create policy "members read products" on public.products
for select to authenticated
using (
  (
    private.has_tenant_permission(tenant_id,'products_read')
    or private.has_tenant_permission(tenant_id,'cash_register')
  )
  and is_tenant_member(tenant_id)
);
