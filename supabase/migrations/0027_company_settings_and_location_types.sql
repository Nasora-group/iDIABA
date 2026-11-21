-- iDIABA Sprint 27: company identity, fiscal defaults and typed stock locations.
-- Additive only: existing tenant, location and transaction rows are preserved.

alter table public.tenants
  add column if not exists logo_url text,
  add column if not exists rccm text not null default '',
  add column if not exists ninea text not null default '',
  add column if not exists address text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists currency_code text not null default 'XOF',
  add column if not exists default_tax_rate numeric(5,2) not null default 18;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='tenants_currency_code_check') then
    alter table public.tenants add constraint tenants_currency_code_check
      check (currency_code ~ '^[A-Z]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='tenants_default_tax_rate_check') then
    alter table public.tenants add constraint tenants_default_tax_rate_check
      check (default_tax_rate >= 0 and default_tax_rate <= 100);
  end if;
end;
$$;

alter table public.stock_locations
  add column if not exists location_type text not null default 'store',
  add column if not exists address text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists is_default boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='stock_locations_type_check') then
    alter table public.stock_locations add constraint stock_locations_type_check
      check (location_type in ('store','warehouse'));
  end if;
end;
$$;

create unique index if not exists stock_locations_one_default_per_tenant_idx
  on public.stock_locations(tenant_id) where is_default = true;

-- Harden every SECURITY DEFINER routine against search_path object-shadowing.
-- Fully-qualified regprocedure signatures safely handle overloaded functions.
do $$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('alter function %s set search_path = pg_catalog, public', routine.signature);
  end loop;
end;
$$;
