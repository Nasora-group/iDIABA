-- Sprint 12: index missing foreign-key columns and avoid per-row auth function evaluation in RLS.
do $$
declare
  fk record;
  index_name text;
begin
  for fk in
    select
      c.conrelid,
      c.conname,
      c.conkey,
      ns.nspname as schema_name,
      tbl.relname as table_name,
      (
        select string_agg(format('%I', att.attname), ', ' order by key_col.ord)
        from unnest(c.conkey) with ordinality as key_col(attnum,ord)
        join pg_attribute att
          on att.attrelid=c.conrelid and att.attnum=key_col.attnum
      ) as columns_sql
    from pg_constraint c
    join pg_class tbl on tbl.oid=c.conrelid
    join pg_namespace ns on ns.oid=tbl.relnamespace
    where c.contype='f' and ns.nspname='public'
  loop
    if not exists (
      select 1
      from pg_index idx
      where idx.indrelid=fk.conrelid
        and idx.indisvalid
        and idx.indpred is null
        and idx.indnkeyatts >= array_length(fk.conkey,1)
        and array(
          select idx.indkey[gs.pos]::smallint
          from generate_series(0,array_length(fk.conkey,1)-1) as gs(pos)
          order by gs.pos
        ) = fk.conkey
    ) then
      index_name := left('idx_fk_' || fk.table_name || '_' || substr(md5(fk.conname),1,10),63);
      execute format(
        'create index if not exists %I on %I.%I (%s)',
        index_name, fk.schema_name, fk.table_name, fk.columns_sql
      );
    end if;
  end loop;
end;
$$;

drop policy if exists "profiles read self" on public.profiles;
create policy "profiles read self" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles update self" on public.profiles;
create policy "profiles update self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "tenant owners create subscription requests" on public.subscription_requests;
create policy "tenant owners create subscription requests" on public.subscription_requests
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.has_tenant_role(tenant_id,array['owner','admin']::public.tenant_role[])
  );
