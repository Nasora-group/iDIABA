-- Company-level team administration. Only company admins can manage memberships.
-- Platform admins remain a separate role in auth app_metadata and cannot be granted here.
create or replace function public.manage_tenant_member(
  p_tenant_id uuid,
  p_email text,
  p_full_name text default '',
  p_role public.tenant_role default 'cashier',
  p_action text default 'add'
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_target uuid;
  v_membership_role public.tenant_role;
  v_count integer;
  v_max_users integer;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not public.has_tenant_role(p_tenant_id, array['owner','admin']::public.tenant_role[]) then
    raise exception 'Only company administrators can manage team members';
  end if;
  if p_action not in ('add','update','remove') then raise exception 'Invalid action'; end if;
  if p_email is null or length(trim(p_email)) not between 3 and 254
     or (trim(p_email) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and trim(p_email) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
    raise exception 'Invalid email or user ID';
  end if;
  if p_role in ('owner') then raise exception 'Owner role cannot be assigned through team management'; end if;
  if p_role not in ('admin','manager','cashier','stock','accountant','viewer') then
    raise exception 'Unsupported role';
  end if;

  select u.id into v_target from auth.users u
    where lower(u.email)=lower(trim(p_email)) or u.id::text=trim(p_email) limit 1;
  if v_target is null then
    raise exception 'No account found for this email. The user must create an iDIABA account first.';
  end if;

  if p_action='add' then
    if exists(select 1 from public.tenant_memberships where tenant_id=p_tenant_id and user_id=v_target) then
      raise exception 'This user is already a member of the company';
    end if;
    select count(*) into v_count from public.tenant_memberships where tenant_id=p_tenant_id;
    select sp.max_users into v_max_users
      from public.tenant_subscriptions ts join public.subscription_plans sp on sp.id=ts.plan_id
      where ts.tenant_id=p_tenant_id and ts.status in ('active','trialing')
      order by ts.created_at desc limit 1;
    if v_max_users is not null and v_count >= v_max_users then
      raise exception 'User quota reached for this subscription';
    end if;
    insert into public.tenant_memberships(tenant_id,user_id,role)
      values(p_tenant_id,v_target,p_role);
  elsif p_action='update' then
    select role into v_membership_role from public.tenant_memberships
      where tenant_id=p_tenant_id and user_id=v_target for update;
    if not found then raise exception 'Membership not found'; end if;
    if v_membership_role='owner' then raise exception 'The owner role is protected'; end if;
    update public.tenant_memberships set role=p_role
      where tenant_id=p_tenant_id and user_id=v_target;
  else
    select role into v_membership_role from public.tenant_memberships
      where tenant_id=p_tenant_id and user_id=v_target for update;
    if not found then raise exception 'Membership not found'; end if;
    if v_membership_role='owner' then raise exception 'The owner role is protected'; end if;
    if v_target=v_actor then raise exception 'You cannot remove your own administrator access'; end if;
    delete from public.tenant_memberships where tenant_id=p_tenant_id and user_id=v_target;
  end if;

  if p_action <> 'remove' and p_full_name is not null and length(trim(p_full_name)) <= 120 then
    update public.profiles set full_name=trim(p_full_name), updated_at=now() where id=v_target;
  end if;
  return v_target;
end;
$$;
revoke execute on function public.manage_tenant_member(uuid,text,text,public.tenant_role,text) from public, anon;
grant execute on function public.manage_tenant_member(uuid,text,text,public.tenant_role,text) to authenticated;
