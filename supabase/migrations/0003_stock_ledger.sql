
-- Accurate on-hand balances are aggregated over the complete immutable ledger.
create or replace view public.stock_balances
with (security_invoker = true)
as
select tenant_id, location_id, product_id, sum(quantity_delta)::numeric(14,3) as quantity_on_hand
from public.stock_movements
group by tenant_id, location_id, product_id;

grant select on public.stock_balances to authenticated;
