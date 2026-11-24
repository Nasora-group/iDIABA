-- Replace legacy role-group write policies with explicit module permissions.
do $$
declare
  r record;
  permission_key text;
  using_expr text;
  check_expr text;
begin
  for r in
    select tablename, policyname, cmd
    from pg_policies
    where schemaname='public'
      and cmd in ('INSERT','UPDATE','DELETE')
      and tablename in (
        'price_lists','product_categories','product_prices','product_recipe_items',
        'product_recipes','products','stock_location_memberships','stock_locations',
        'stock_movements','stock_reorder_thresholds','suppliers'
      )
  loop
    permission_key := case
      when r.tablename in ('price_lists','product_categories','product_prices','product_recipe_items','product_recipes','products') then 'products_manage'
      when r.tablename in ('stock_location_memberships','stock_locations','stock_movements','stock_reorder_thresholds') then 'stock_manage'
      when r.tablename='suppliers' then 'purchasing_manage'
      else null
    end;
    if permission_key is null then continue; end if;

    using_expr := format('private.has_tenant_permission(tenant_id, %L)', permission_key);
    check_expr := using_expr;

    if r.tablename='stock_movements' then
      check_expr := check_expr || ' and has_stock_location_access(tenant_id, location_id)';
    elsif r.tablename='stock_reorder_thresholds' then
      using_expr := using_expr || ' and private.has_stock_location_access(tenant_id, location_id)';
      check_expr := check_expr || ' and private.has_stock_location_access(tenant_id, location_id)';
    elsif r.tablename='stock_location_memberships' and r.cmd='INSERT' then
      check_expr := '(assigned_by = (select auth.uid())) and ' || check_expr;
    end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    if r.cmd='INSERT' then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
        r.policyname, r.tablename, check_expr);
    elsif r.cmd='UPDATE' then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
        r.policyname, r.tablename, using_expr, check_expr);
    else
      execute format('create policy %I on public.%I for delete to authenticated using (%s)',
        r.policyname, r.tablename, using_expr);
    end if;
  end loop;
end;
$$;
