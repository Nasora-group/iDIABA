-- Customer editing and lifecycle controls; keep historical sales and returns intact.
create or replace function public.update_customer(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_name text,
  p_phone text default '',
  p_email text default '',
  p_address text default '',
  p_notes text default ''
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.has_tenant_role(p_tenant_id, array['owner','admin','manager','cashier']::public.tenant_role[]) then
    raise exception 'Permission denied to update customer';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 160
     or length(coalesce(p_phone,'')) > 40
     or length(coalesce(p_email,'')) > 254
     or length(coalesce(p_address,'')) > 500
     or length(coalesce(p_notes,'')) > 1000 then
    raise exception 'Invalid customer information';
  end if;
  update public.customers
     set name=trim(p_name),
         phone=trim(coalesce(p_phone,'')),
         email=lower(trim(coalesce(p_email,''))),
         address=trim(coalesce(p_address,'')),
         notes=trim(coalesce(p_notes,'')),
         updated_at=now()
   where id=p_customer_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Customer not found'; end if;
end;
$$;

create or replace function public.set_customer_active(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not public.has_tenant_role(p_tenant_id, array['owner','admin','manager','cashier']::public.tenant_role[]) then
    raise exception 'Permission denied to change customer status';
  end if;
  update public.customers
     set is_active=coalesce(p_active,false), updated_at=now()
   where id=p_customer_id and tenant_id=p_tenant_id;
  if not found then raise exception 'Customer not found'; end if;
end;
$$;

revoke all on function public.update_customer(uuid,uuid,text,text,text,text,text) from public, anon;
grant execute on function public.update_customer(uuid,uuid,text,text,text,text,text) to authenticated;
revoke all on function public.set_customer_active(uuid,uuid,boolean) from public, anon;
grant execute on function public.set_customer_active(uuid,uuid,boolean) to authenticated;
