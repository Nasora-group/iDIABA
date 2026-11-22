-- Universal commerce: product variants, customer price lists and recipes.
-- Additive only. Existing products and commercial history are preserved.
alter table public.products
  add column if not exists parent_product_id uuid references public.products(id) on delete restrict,
  add column if not exists variant_attributes jsonb not null default '{}'::jsonb;

alter table public.products add constraint products_variant_attributes_object
  check (jsonb_typeof(variant_attributes) = 'object');

create index if not exists products_parent_product_idx
  on public.products(tenant_id, parent_product_id) where parent_product_id is not null;

create table public.price_lists (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 100),
  customer_segment text not null default 'all' check (customer_segment in ('all','retail','professional','wholesale','reseller','custom')),
  currency_code text not null default 'XOF' check (currency_code ~ '^[A-Z]{3}$'),
  valid_from date, valid_until date,
  is_default boolean not null default false, is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create unique index price_lists_one_default_per_tenant on public.price_lists(tenant_id)
  where is_default and is_active;

create table public.product_prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, price_list_id uuid not null, product_id uuid not null,
  minimum_quantity numeric(14,3) not null default 1 check (minimum_quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (tenant_id,price_list_id) references public.price_lists(tenant_id,id) on delete cascade,
  foreign key (product_id) references public.products(id) on delete restrict,
  unique (tenant_id,price_list_id,product_id,minimum_quantity)
);
create index product_prices_lookup_idx on public.product_prices(tenant_id,price_list_id,product_id,minimum_quantity desc);

create table public.product_recipes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, product_id uuid not null,
  yield_quantity numeric(14,3) not null default 1 check (yield_quantity > 0),
  yield_unit text not null default 'unité' check (length(trim(yield_unit)) between 1 and 24),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (product_id) references public.products(id) on delete restrict,
  unique (tenant_id,product_id), unique (tenant_id,id)
);

create table public.product_recipe_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, recipe_id uuid not null, ingredient_product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null check (length(trim(unit)) between 1 and 24),
  waste_percentage numeric(6,3) not null default 0 check (waste_percentage between 0 and 100),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,recipe_id) references public.product_recipes(tenant_id,id) on delete cascade,
  foreign key (ingredient_product_id) references public.products(id) on delete restrict,
  unique (tenant_id,recipe_id,ingredient_product_id)
);
create index product_recipe_items_ingredient_idx on public.product_recipe_items(tenant_id,ingredient_product_id);

create function public.guard_universal_catalog_relations()
returns trigger language plpgsql security invoker set search_path = public
as $$
declare v_tenant uuid; v_stock boolean;
begin
  if tg_table_name = 'products' then
    if new.parent_product_id is not null then
      select tenant_id into v_tenant from public.products where id = new.parent_product_id;
      if not found or v_tenant <> new.tenant_id or new.parent_product_id = new.id then
        raise exception 'Variant parent must belong to the same company';
      end if;
    end if;
    return new;
  elsif tg_table_name = 'product_prices' then
    select tenant_id into v_tenant from public.products where id = new.product_id;
    if not found or v_tenant <> new.tenant_id then raise exception 'Priced product must belong to the same company'; end if;
    return new;
  elsif tg_table_name = 'product_recipes' then
    select tenant_id into v_tenant from public.products where id = new.product_id;
    if not found or v_tenant <> new.tenant_id then raise exception 'Recipe product must belong to the same company'; end if;
    return new;
  else
    select tenant_id,track_stock into v_tenant,v_stock from public.products where id = new.ingredient_product_id;
    if not found or v_tenant <> new.tenant_id or not v_stock then
      raise exception 'Recipe ingredients must be stock-tracked products from the same company';
    end if;
    return new;
  end if;
end;
$$;

create trigger products_variant_same_tenant before insert or update of tenant_id,parent_product_id
  on public.products for each row execute function public.guard_universal_catalog_relations();
create trigger product_prices_same_tenant before insert or update of tenant_id,product_id
  on public.product_prices for each row execute function public.guard_universal_catalog_relations();
create trigger product_recipes_same_tenant before insert or update of tenant_id,product_id
  on public.product_recipes for each row execute function public.guard_universal_catalog_relations();
create trigger product_recipe_items_same_tenant before insert or update of tenant_id,ingredient_product_id
  on public.product_recipe_items for each row execute function public.guard_universal_catalog_relations();
revoke all on function public.guard_universal_catalog_relations() from public,anon,authenticated;

alter table public.price_lists enable row level security;
alter table public.product_prices enable row level security;
alter table public.product_recipes enable row level security;
alter table public.product_recipe_items enable row level security;

create policy "tenant members read price lists" on public.price_lists for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "tenant managers manage price lists" on public.price_lists for all to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant members read product prices" on public.product_prices for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "tenant managers manage product prices" on public.product_prices for all to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant members read recipes" on public.product_recipes for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "tenant managers manage recipes" on public.product_recipes for all to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
create policy "tenant members read recipe items" on public.product_recipe_items for select to authenticated using (public.is_tenant_member(tenant_id));
create policy "tenant managers manage recipe items" on public.product_recipe_items for all to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]))
  with check (public.has_tenant_role(tenant_id,array['owner','admin','manager']::public.tenant_role[]));
grant select,insert,update,delete on public.price_lists,public.product_prices,public.product_recipes,public.product_recipe_items to authenticated;
