-- Sprint 7: tenant-scoped double-entry accounting and expenses (FCFA).
create table if not exists public.accounting_accounts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 code text not null, name text not null, account_class text not null check(account_class in ('asset','liability','equity','revenue','expense')),
 account_kind text not null default 'general' check(account_kind in ('general','cash','bank','tax','customer','supplier')),
 is_active boolean not null default true, created_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,code)
);
create table if not exists public.journal_entries (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 entry_number text not null, entry_date date not null, description text not null,
 source_type text not null default 'manual' check(source_type in ('manual','expense','sale','purchase','cash','opening')),
 source_id uuid, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,entry_number)
);
create table if not exists public.journal_lines (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, journal_entry_id uuid not null, account_id uuid not null,
 description text not null default '', debit numeric(16,2) not null default 0 check(debit>=0),
 credit numeric(16,2) not null default 0 check(credit>=0),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,journal_entry_id) references public.journal_entries(tenant_id,id),
 foreign key(tenant_id,account_id) references public.accounting_accounts(tenant_id,id),
 check((debit>0 and credit=0) or (credit>0 and debit=0))
);
create table if not exists public.expenses (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 journal_entry_id uuid not null, expense_date date not null, description text not null, reference text not null default '',
 amount numeric(14,2) not null check(amount>0), expense_account_id uuid not null, payment_account_id uuid not null,
 created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 foreign key(tenant_id,journal_entry_id) references public.journal_entries(tenant_id,id),
 foreign key(tenant_id,expense_account_id) references public.accounting_accounts(tenant_id,id),
 foreign key(tenant_id,payment_account_id) references public.accounting_accounts(tenant_id,id)
);
create index if not exists journal_entries_tenant_date_idx on public.journal_entries(tenant_id,entry_date desc);
create index if not exists journal_lines_tenant_account_idx on public.journal_lines(tenant_id,account_id);
create index if not exists expenses_tenant_date_idx on public.expenses(tenant_id,expense_date desc);
alter table public.accounting_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.expenses enable row level security;
create policy "members read accounting accounts" on public.accounting_accounts for select to authenticated using(public.is_tenant_member(tenant_id));
create policy "members read journal entries" on public.journal_entries for select to authenticated using(public.is_tenant_member(tenant_id));
create policy "members read journal lines" on public.journal_lines for select to authenticated using(public.is_tenant_member(tenant_id));
create policy "members read expenses" on public.expenses for select to authenticated using(public.is_tenant_member(tenant_id));
grant select on public.accounting_accounts,public.journal_entries,public.journal_lines,public.expenses to authenticated;

create or replace function public.seed_default_accounting_chart(p_tenant_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into public.accounting_accounts(tenant_id,code,name,account_class,account_kind) values
 (p_tenant_id,'101000','Capital social','equity','general'),
 (p_tenant_id,'401000','Fournisseurs','liability','supplier'),
 (p_tenant_id,'411000','Clients','asset','customer'),
 (p_tenant_id,'443000','TVA facturée','liability','tax'),
 (p_tenant_id,'445000','TVA récupérable','asset','tax'),
 (p_tenant_id,'521000','Banque','asset','bank'),
 (p_tenant_id,'571000','Caisse','asset','cash'),
 (p_tenant_id,'601000','Achats de marchandises','expense','general'),
 (p_tenant_id,'622000','Locations et charges locatives','expense','general'),
 (p_tenant_id,'624000','Transports','expense','general'),
 (p_tenant_id,'628000','Autres charges externes','expense','general'),
 (p_tenant_id,'661000','Charges de personnel','expense','general'),
 (p_tenant_id,'701000','Ventes de marchandises','revenue','general'),
 (p_tenant_id,'758000','Autres produits','revenue','general')
 on conflict(tenant_id,code) do nothing;
end; $$;
revoke all on function public.seed_default_accounting_chart(uuid) from public;

create or replace function public.ensure_accounting_chart(p_tenant_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not public.has_tenant_role(p_tenant_id,array['owner','admin','manager','accountant']::public.tenant_role[]) then
  raise exception 'Permission denied';
 end if;
 perform public.seed_default_accounting_chart(p_tenant_id);
end; $$;

create or replace function public.post_manual_journal_entry(p_tenant_id uuid,p_entry_date date,p_description text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=gen_random_uuid(); v_number text; v_line jsonb; v_account uuid; v_debit numeric(16,2); v_credit numeric(16,2); v_dr numeric(16,2):=0; v_cr numeric(16,2):=0; v_count int:=0;
begin
 if auth.uid() is null or not public.has_tenant_role(p_tenant_id,array['owner','admin','manager','accountant']::public.tenant_role[]) then raise exception 'Permission denied'; end if;
 if p_entry_date is null or length(trim(coalesce(p_description,''))) not between 2 and 250 or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)<2 or jsonb_array_length(p_lines)>100 then raise exception 'Invalid journal entry'; end if;
 v_number:='OD-'||to_char(p_entry_date,'YYYYMMDD')||'-'||upper(substr(replace(v_id::text,'-',''),1,8));
 insert into public.journal_entries(id,tenant_id,entry_number,entry_date,description,source_type,created_by) values(v_id,p_tenant_id,v_number,p_entry_date,trim(p_description),'manual',auth.uid());
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_count:=v_count+1; v_account:=(v_line->>'account_id')::uuid;
  v_debit:=round(coalesce((v_line->>'debit')::numeric,0),2); v_credit:=round(coalesce((v_line->>'credit')::numeric,0),2);
  if v_debit<0 or v_credit<0 or not ((v_debit>0 and v_credit=0) or (v_credit>0 and v_debit=0)) then raise exception 'Invalid debit/credit line'; end if;
  if not exists(select 1 from public.accounting_accounts where id=v_account and tenant_id=p_tenant_id and is_active) then raise exception 'Account unavailable'; end if;
  insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit) values(p_tenant_id,v_id,v_account,left(coalesce(v_line->>'description',''),250),v_debit,v_credit);
  v_dr:=v_dr+v_debit; v_cr:=v_cr+v_credit;
 end loop;
 if v_count<2 or v_dr<=0 or v_dr<>v_cr then raise exception 'Journal entry must be balanced'; end if;
 return v_id;
end; $$;

create or replace function public.create_expense(p_tenant_id uuid,p_expense_date date,p_description text,p_amount numeric,p_expense_account_id uuid,p_payment_account_id uuid,p_reference text default '')
returns uuid language plpgsql security definer set search_path=public as $$
declare v_expense uuid:=gen_random_uuid(); v_entry uuid:=gen_random_uuid(); v_number text;
begin
 if auth.uid() is null or not public.has_tenant_role(p_tenant_id,array['owner','admin','manager','accountant']::public.tenant_role[]) then raise exception 'Permission denied'; end if;
 if p_expense_date is null or length(trim(coalesce(p_description,''))) not between 2 and 250 or p_amount is null or p_amount<=0 then raise exception 'Invalid expense'; end if;
 if not exists(select 1 from public.accounting_accounts where id=p_expense_account_id and tenant_id=p_tenant_id and is_active and account_class='expense') then raise exception 'Invalid expense account'; end if;
 if not exists(select 1 from public.accounting_accounts where id=p_payment_account_id and tenant_id=p_tenant_id and is_active and account_kind in ('cash','bank')) then raise exception 'Invalid payment account'; end if;
 v_number:='EX-'||to_char(p_expense_date,'YYYYMMDD')||'-'||upper(substr(replace(v_entry::text,'-',''),1,8));
 insert into public.journal_entries(id,tenant_id,entry_number,entry_date,description,source_type,source_id,created_by) values(v_entry,p_tenant_id,v_number,p_expense_date,trim(p_description),'expense',v_expense,auth.uid());
 insert into public.journal_lines(tenant_id,journal_entry_id,account_id,description,debit,credit) values
 (p_tenant_id,v_entry,p_expense_account_id,trim(p_description),round(p_amount,2),0),
 (p_tenant_id,v_entry,p_payment_account_id,trim(p_description),0,round(p_amount,2));
 insert into public.expenses(id,tenant_id,journal_entry_id,expense_date,description,reference,amount,expense_account_id,payment_account_id,created_by)
 values(v_expense,p_tenant_id,v_entry,p_expense_date,trim(p_description),left(coalesce(p_reference,''),100),round(p_amount,2),p_expense_account_id,p_payment_account_id,auth.uid());
 return v_expense;
end; $$;

create or replace view public.accounting_trial_balance with(security_invoker=true) as
select a.tenant_id,a.id account_id,a.code,a.name,a.account_class,
 coalesce(sum(l.debit),0)::numeric(16,2) total_debit,
 coalesce(sum(l.credit),0)::numeric(16,2) total_credit,
 (coalesce(sum(l.debit),0)-coalesce(sum(l.credit),0))::numeric(16,2) net_balance
from public.accounting_accounts a left join public.journal_lines l on l.account_id=a.id and l.tenant_id=a.tenant_id
where a.is_active group by a.tenant_id,a.id,a.code,a.name,a.account_class;
grant select on public.accounting_trial_balance to authenticated;

create or replace function public.prevent_accounting_mutation()
returns trigger language plpgsql as $$ begin raise exception 'Posted accounting records are immutable; use a reversal entry.'; end; $$;
drop trigger if exists journal_entries_immutable on public.journal_entries;
create trigger journal_entries_immutable before update or delete on public.journal_entries for each row execute function public.prevent_accounting_mutation();
drop trigger if exists journal_lines_immutable on public.journal_lines;
create trigger journal_lines_immutable before update or delete on public.journal_lines for each row execute function public.prevent_accounting_mutation();
drop trigger if exists expenses_immutable on public.expenses;
create trigger expenses_immutable before update or delete on public.expenses for each row execute function public.prevent_accounting_mutation();

revoke all on function public.ensure_accounting_chart(uuid) from public;
revoke all on function public.post_manual_journal_entry(uuid,date,text,jsonb) from public;
revoke all on function public.create_expense(uuid,date,text,numeric,uuid,uuid,text) from public;
grant execute on function public.ensure_accounting_chart(uuid) to authenticated;
grant execute on function public.post_manual_journal_entry(uuid,date,text,jsonb) to authenticated;
grant execute on function public.create_expense(uuid,date,text,numeric,uuid,uuid,text) to authenticated;
