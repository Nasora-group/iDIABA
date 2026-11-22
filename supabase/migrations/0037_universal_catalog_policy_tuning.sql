-- Keep read access for tenant members and limit write policies to write actions.
drop policy if exists "tenant managers manage price lists" on public.price_lists;
create policy "tenant managers insert price lists" on public.price_lists for insert to authenticated
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant managers update price lists" on public.price_lists for update to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant managers delete price lists" on public.price_lists for delete to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));

drop policy if exists "tenant managers manage product prices" on public.product_prices;
create policy "tenant managers insert product prices" on public.product_prices for insert to authenticated
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant managers update product prices" on public.product_prices for update to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant managers delete product prices" on public.product_prices for delete to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));

drop policy if exists "tenant managers manage recipes" on public.product_recipes;
create policy "tenant managers insert recipes" on public.product_recipes for insert to authenticated
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant managers update recipes" on public.product_recipes for update to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant managers delete recipes" on public.product_recipes for delete to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));

drop policy if exists "tenant managers manage recipe items" on public.product_recipe_items;
create policy "tenant managers insert recipe items" on public.product_recipe_items for insert to authenticated
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant managers update recipe items" on public.product_recipe_items for update to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant managers delete recipe items" on public.product_recipe_items for delete to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));

create index if not exists price_lists_created_by_idx on public.price_lists(created_by);
