-- Keep the permission evaluator outside the exposed Data API schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.has_tenant_permission(
  target_tenant uuid,
  required_permission text
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','public','private'
as $function$
  select
    required_permission = any(array[
      'cash_register','sales_read','sales_manage',
      'products_read','products_manage','stock_read','stock_manage',
      'purchasing_read','purchasing_manage','reports_read',
      'accounting_read','accounting_manage','team_manage',
      'settings_manage','audit_read'
    ]::text[])
    and exists (
      select 1
      from public.tenant_memberships m
      left join public.tenant_role_profiles p
        on p.id = m.custom_role_profile_id
       and p.tenant_id = m.tenant_id
      where m.tenant_id = target_tenant
        and m.user_id = auth.uid()
        and (
          m.role in ('owner','admin')
          or (
            m.custom_role_profile_id is not null
            and (
              required_permission = any(p.permissions)
              or (
                cardinality(p.permissions) = 0
                and (
                  (required_permission = 'cash_register' and 'cashier' = any(p.allowed_roles))
                  or (required_permission in ('sales_read','sales_manage') and p.allowed_roles && array['manager','cashier','accountant','viewer']::public.tenant_role[])
                  or (required_permission in ('products_read','products_manage','stock_read','stock_manage') and p.allowed_roles && array['manager','stock','viewer']::public.tenant_role[])
                  or (required_permission in ('purchasing_read','purchasing_manage') and p.allowed_roles && array['manager','stock','accountant','viewer']::public.tenant_role[])
                  or (required_permission in ('reports_read','accounting_read') and p.allowed_roles && array['manager','accountant','viewer']::public.tenant_role[])
                  or (required_permission = 'accounting_manage' and p.allowed_roles && array['manager','accountant']::public.tenant_role[])
                  or (required_permission in ('team_manage','settings_manage','audit_read') and 'manager' = any(p.allowed_roles))
                )
              )
            )
          )
          or (
            m.custom_role_profile_id is null
            and (
              (required_permission = 'cash_register' and m.role = 'cashier')
              or (required_permission in ('sales_read','sales_manage') and m.role in ('manager','cashier','accountant','viewer'))
              or (required_permission in ('products_read','products_manage','stock_read','stock_manage') and m.role in ('manager','stock','viewer'))
              or (required_permission in ('purchasing_read','purchasing_manage') and m.role in ('manager','stock','accountant','viewer'))
              or (required_permission in ('reports_read','accounting_read') and m.role in ('manager','accountant','viewer'))
              or (required_permission = 'accounting_manage' and m.role in ('manager','accountant'))
              or (required_permission in ('team_manage','settings_manage','audit_read') and m.role = 'manager')
            )
          )
        )
    );
$function$;

revoke all on function private.has_tenant_permission(uuid,text) from public, anon;
grant execute on function private.has_tenant_permission(uuid,text) to authenticated;
drop function if exists public.has_tenant_permission(uuid,text);
