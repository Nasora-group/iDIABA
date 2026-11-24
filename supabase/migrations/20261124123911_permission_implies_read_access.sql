CREATE OR REPLACE FUNCTION private.has_tenant_permission(target_tenant uuid, required_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select
    required_permission = any(array[
      'cash_register','cash_manage','sales_read','sales_manage',
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
              (
              required_permission = any(p.permissions)
              or (required_permission = 'cash_register' and 'cash_manage' = any(p.permissions))
              or (required_permission = 'sales_read' and 'sales_manage' = any(p.permissions))
              or (required_permission = 'products_read' and 'products_manage' = any(p.permissions))
              or (required_permission = 'stock_read' and 'stock_manage' = any(p.permissions))
              or (required_permission = 'purchasing_read' and 'purchasing_manage' = any(p.permissions))
              or (required_permission = 'accounting_read' and 'accounting_manage' = any(p.permissions))
            )
              or (
                cardinality(p.permissions) = 0
                and (
                  (required_permission = 'cash_register' and 'cashier' = any(p.allowed_roles))
                  or (required_permission in ('sales_read','sales_manage') and p.allowed_roles && array['manager','cashier','accountant','viewer']::public.tenant_role[])
                  or (required_permission in ('products_read','products_manage','stock_read','stock_manage') and p.allowed_roles && array['manager','stock','viewer']::public.tenant_role[])
                  or (required_permission in ('purchasing_read','purchasing_manage') and p.allowed_roles && array['manager','stock','accountant','viewer']::public.tenant_role[])
                  or (required_permission in ('reports_read','accounting_read') and p.allowed_roles && array['manager','accountant','viewer']::public.tenant_role[])
                  or (required_permission = 'accounting_manage' and p.allowed_roles && array['manager','accountant']::public.tenant_role[])
                  or (required_permission in ('team_manage','settings_manage','audit_read','cash_manage') and 'manager' = any(p.allowed_roles))
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
              or (required_permission in ('team_manage','settings_manage','audit_read','cash_manage') and m.role = 'manager')
            )
          )
        )
    );
$function$
;
