-- iDIABA Sprint 17: multi-company workspace
-- Team invitations, member role management, co-member profile visibility and
-- a cap on the number of companies a single account can create.
-- All write paths go through SECURITY DEFINER functions that enforce roles.

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null check (
    email = lower(trim(email))
    and length(email) <= 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  role public.tenant_role not null default 'viewer',
  token text not null unique
    default replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index if not exists tenant_invitations_one_pending_per_email
  on public.tenant_invitations(tenant_id,email) where status='pending';
create index if not exists tenant_invitations_tenant_created_idx
  on public.tenant_invitations(tenant_id,created_at desc);
create index if not exists tenant_invitations_invited_by_idx
  on public.tenant_invitations(invited_by);
create index if not exists tenant_invitations_accepted_by_idx
  on public.tenant_invitations(accepted_by) where accepted_by is not null;

alter table public.tenant_invitations enable row level security;

drop policy if exists "tenant admins read invitations" on public.tenant_invitations;
create policy "tenant admins read invitations" on public.tenant_invitations
  for select to authenticated
  using (public.has_tenant_role(tenant_id,array['owner','admin']::public.tenant_role[]));

grant select on public.tenant_invitations to authenticated;

drop trigger if exists tenant_audit_log on public.tenant_invitations;
create trigger tenant_audit_log after insert or update or delete on public.tenant_invitations
  for each row execute function public.capture_tenant_audit_log();

-- ---------------------------------------------------------------------------
-- Co-member profile visibility (cashier names on tickets, team lists, etc.)
-- ---------------------------------------------------------------------------
create or replace function public.shares_tenant_with(target_user uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists(
    select 1
    from public.tenant_memberships mine
    join public.tenant_memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = target_user
  );
$$;
revoke all on function public.shares_tenant_with(uuid) from public,anon;
grant execute on function public.shares_tenant_with(uuid) to authenticated;

drop policy if exists "profiles read co-members" on public.profiles;
create policy "profiles read co-members" on public.profiles
  for select to authenticated using (public.shares_tenant_with(id));

-- ---------------------------------------------------------------------------
-- Company creation: cap the number of companies created per account so the
-- free trial cannot be farmed by creating unlimited workspaces.
-- ---------------------------------------------------------------------------
create or replace function public.create_tenant(workspace_name text, workspace_slug text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$
declare new_tenant_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(workspace_name)) < 2 or length(trim(workspace_name)) > 120 then raise exception 'Workspace name must be 2-120 characters'; end if;
  if workspace_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(workspace_slug) > 60 then raise exception 'Invalid workspace slug'; end if;
  if (select count(*) from public.tenants where created_by = auth.uid()) >= 5 then
    raise exception 'Limite de 5 entreprises créées par compte atteinte. Contactez le support pour en ajouter.';
  end if;
  insert into public.tenants(name,slug,created_by) values(trim(workspace_name),workspace_slug,auth.uid()) returning id into new_tenant_id;
  insert into public.tenant_memberships(tenant_id,user_id,role) values(new_tenant_id,auth.uid(),'owner');
  return new_tenant_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Team listing (names + e-mails live in auth.users, so this is a controlled RPC)
-- ---------------------------------------------------------------------------
create or replace function public.list_tenant_members(target_tenant uuid)
returns table(user_id uuid, role public.tenant_role, full_name text, email text, joined_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_tenant_role(target_tenant,array['owner','admin']::public.tenant_role[]) then
    raise exception 'Droits insuffisants pour consulter l''équipe.';
  end if;
  return query
    select m.user_id, m.role, coalesce(p.full_name,'')::text, coalesce(u.email,'')::text, m.created_at
    from public.tenant_memberships m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
    where m.tenant_id = target_tenant
    order by m.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invitations: create / revoke / preview / accept
-- ---------------------------------------------------------------------------
create or replace function public.create_invitation(target_tenant uuid, invitee_email text, invitee_role public.tenant_role)
returns text language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_caller public.tenant_role;
  v_email text := lower(trim(coalesce(invitee_email,'')));
  v_token text;
  v_max integer;
  v_members bigint;
  v_pending bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select m.role into v_caller from public.tenant_memberships m where m.tenant_id=target_tenant and m.user_id=auth.uid();
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'Droits insuffisants pour inviter un membre.'; end if;
  if v_caller='admin' and invitee_role in ('owner','admin') then
    raise exception 'Seul un propriétaire peut inviter un administrateur ou un propriétaire.';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then
    raise exception 'Adresse e-mail invalide.';
  end if;
  if exists(
    select 1 from public.tenant_memberships m join auth.users u on u.id=m.user_id
    where m.tenant_id=target_tenant and lower(u.email)=v_email
  ) then
    raise exception 'Cette personne fait déjà partie de l''entreprise.';
  end if;

  -- Expired invitations no longer block a new one for the same address.
  update public.tenant_invitations set status='revoked'
  where tenant_id=target_tenant and email=v_email and status='pending' and expires_at <= now();

  select p.max_users into v_max
  from public.tenant_subscriptions s join public.subscription_plans p on p.id=s.plan_id
  where s.tenant_id=target_tenant;
  if v_max is not null then
    select count(*) into v_members from public.tenant_memberships where tenant_id=target_tenant;
    select count(*) into v_pending from public.tenant_invitations
      where tenant_id=target_tenant and status='pending' and expires_at > now();
    if v_members + v_pending >= v_max then
      raise exception 'Limite d''utilisateurs atteinte (%). Passez à une formule supérieure avant d''inviter.',v_max;
    end if;
  end if;

  begin
    insert into public.tenant_invitations(tenant_id,email,role,invited_by)
    values(target_tenant,v_email,invitee_role,auth.uid())
    returning token into v_token;
  exception when unique_violation then
    raise exception 'Une invitation est déjà en attente pour cette adresse e-mail.';
  end;
  return v_token;
end;
$$;

create or replace function public.revoke_invitation(target_invitation uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select tenant_id into v_tenant from public.tenant_invitations where id=target_invitation;
  if v_tenant is null then raise exception 'Invitation introuvable.'; end if;
  if not public.has_tenant_role(v_tenant,array['owner','admin']::public.tenant_role[]) then
    raise exception 'Droits insuffisants pour annuler cette invitation.';
  end if;
  update public.tenant_invitations set status='revoked' where id=target_invitation and status='pending';
end;
$$;

create or replace function public.get_invitation_preview(invite_token text)
returns table(tenant_name text, role public.tenant_role, status text, expired boolean, email_matches boolean)
language plpgsql stable security definer set search_path = pg_catalog, public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return query
    select t.name::text, i.role, i.status::text, (i.expires_at <= now()),
           (i.email = lower(coalesce(auth.jwt()->>'email','')))
    from public.tenant_invitations i join public.tenants t on t.id=i.tenant_id
    where i.token = invite_token;
end;
$$;

create or replace function public.accept_invitation(invite_token text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_invite public.tenant_invitations%rowtype;
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_invite from public.tenant_invitations where token=invite_token for update;
  if not found then raise exception 'Invitation introuvable.'; end if;
  if v_invite.status <> 'pending' then raise exception 'Cette invitation a déjà été utilisée ou annulée.'; end if;
  if v_invite.expires_at <= now() then raise exception 'Cette invitation a expiré. Demandez-en une nouvelle.'; end if;
  if v_invite.email <> v_email then raise exception 'Cette invitation est destinée à une autre adresse e-mail.'; end if;

  if not exists(select 1 from public.tenant_memberships where tenant_id=v_invite.tenant_id and user_id=auth.uid()) then
    -- The subscription_guard trigger enforces the plan's user quota here.
    insert into public.tenant_memberships(tenant_id,user_id,role) values(v_invite.tenant_id,auth.uid(),v_invite.role);
  end if;
  update public.tenant_invitations set status='accepted', accepted_by=auth.uid(), accepted_at=now() where id=v_invite.id;
  return v_invite.tenant_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member management
-- ---------------------------------------------------------------------------
create or replace function public.set_member_role(target_tenant uuid, target_user uuid, new_role public.tenant_role)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_caller public.tenant_role; v_current public.tenant_role;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_caller from public.tenant_memberships where tenant_id=target_tenant and user_id=auth.uid();
  if v_caller is null or v_caller not in ('owner','admin') then raise exception 'Droits insuffisants pour modifier les rôles.'; end if;
  select role into v_current from public.tenant_memberships where tenant_id=target_tenant and user_id=target_user for update;
  if v_current is null then raise exception 'Membre introuvable dans cette entreprise.'; end if;
  if v_current = new_role then return; end if;
  if v_caller='admin' and (v_current in ('owner','admin') or new_role in ('owner','admin')) then
    raise exception 'Seul un propriétaire peut attribuer ou retirer les rôles propriétaire et administrateur.';
  end if;
  if v_current='owner' and new_role<>'owner'
     and (select count(*) from public.tenant_memberships where tenant_id=target_tenant and role='owner') <= 1 then
    raise exception 'Une entreprise doit conserver au moins un propriétaire.';
  end if;
  update public.tenant_memberships set role=new_role where tenant_id=target_tenant and user_id=target_user;
end;
$$;

create or replace function public.remove_member(target_tenant uuid, target_user uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_caller public.tenant_role; v_target public.tenant_role;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into v_caller from public.tenant_memberships where tenant_id=target_tenant and user_id=auth.uid();
  if v_caller is null then raise exception 'Vous ne faites pas partie de cette entreprise.'; end if;
  select role into v_target from public.tenant_memberships where tenant_id=target_tenant and user_id=target_user for update;
  if v_target is null then raise exception 'Membre introuvable dans cette entreprise.'; end if;

  if target_user <> auth.uid() then
    if v_caller not in ('owner','admin') then raise exception 'Droits insuffisants pour retirer ce membre.'; end if;
    if v_caller='admin' and v_target in ('owner','admin') then
      raise exception 'Seul un propriétaire peut retirer un administrateur ou un propriétaire.';
    end if;
  end if;
  if v_target='owner'
     and (select count(*) from public.tenant_memberships where tenant_id=target_tenant and role='owner') <= 1 then
    raise exception 'Une entreprise doit conserver au moins un propriétaire.';
  end if;
  delete from public.tenant_memberships where tenant_id=target_tenant and user_id=target_user;
end;
$$;

-- Functions are callable only by signed-in users.
revoke all on function public.list_tenant_members(uuid) from public,anon;
revoke all on function public.create_invitation(uuid,text,public.tenant_role) from public,anon;
revoke all on function public.revoke_invitation(uuid) from public,anon;
revoke all on function public.get_invitation_preview(text) from public,anon;
revoke all on function public.accept_invitation(text) from public,anon;
revoke all on function public.set_member_role(uuid,uuid,public.tenant_role) from public,anon;
revoke all on function public.remove_member(uuid,uuid) from public,anon;
grant execute on function public.list_tenant_members(uuid) to authenticated;
grant execute on function public.create_invitation(uuid,text,public.tenant_role) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.get_invitation_preview(text) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.set_member_role(uuid,uuid,public.tenant_role) to authenticated;
grant execute on function public.remove_member(uuid,uuid) to authenticated;
