-- Sprint 14: append-only tenant audit trail for sensitive business operations.
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  entity text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_tenant_created_idx
  on public.audit_logs(tenant_id,created_at desc);
create index if not exists audit_logs_tenant_entity_created_idx
  on public.audit_logs(tenant_id,entity,created_at desc);

alter table public.audit_logs enable row level security;
create policy "tenant owners read audit logs" on public.audit_logs
  for select to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin']::public.tenant_role[]));
grant select on public.audit_logs to authenticated;

create or replace function public.capture_tenant_audit_log()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_tenant_id uuid;
  v_entity_id text;
begin
  if tg_op='DELETE' then
    v_row := to_jsonb(old);
    v_old := v_row;
    v_new := null;
  elsif tg_op='INSERT' then
    v_row := to_jsonb(new);
    v_old := null;
    v_new := v_row;
  else
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);
    v_new := v_row;
  end if;

  v_tenant_id := nullif(v_row->>'tenant_id','')::uuid;
  if v_tenant_id is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  v_entity_id := coalesce(v_row->>'id',v_row->>'user_id',v_row->>'reference',v_row->>'sku');

  insert into public.audit_logs(tenant_id,actor_id,action,entity,entity_id,old_data,new_data)
  values(v_tenant_id,auth.uid(),tg_op,tg_table_name,v_entity_id,v_old,v_new);

  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.capture_tenant_audit_log() from public,anon,authenticated;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'accounting_accounts','cash_movements','cash_sessions','customers','expenses',
    'inventory_count_items','inventory_counts','journal_entries','journal_lines',
    'product_categories','products','purchase_order_items','purchase_orders',
    'purchase_receipt_items','purchase_receipts','sale_items','sale_payments',
    'sale_return_items','sale_returns','sales','stock_locations','stock_movements',
    'suppliers','tenant_memberships','tenant_subscriptions','subscription_requests'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('drop trigger if exists tenant_audit_log on public.%I',v_table);
    execute format('create trigger tenant_audit_log after insert or update or delete on public.%I for each row execute function public.capture_tenant_audit_log()',v_table);
  end loop;
end;
$$;
