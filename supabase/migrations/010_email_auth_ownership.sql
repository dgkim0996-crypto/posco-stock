create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create unique index if not exists accounts_user_id_unique_idx
  on public.accounts(user_id) where user_id is not null;

create or replace function public.provision_user_account(p_user_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_account public.accounts%rowtype;
begin
  if not exists(select 1 from auth.users where id=p_user_id) then
    raise exception using errcode='P0002',message='인증 사용자를 찾을 수 없습니다.';
  end if;

  insert into public.profiles(id,email,updated_at)
  values(p_user_id,p_email,now())
  on conflict(id) do update set email=excluded.email,updated_at=now();

  select * into v_account from public.accounts where user_id=p_user_id for update;
  if not found then
    insert into public.accounts(account_number,user_id,krw_balance,usd_balance)
    values('POSCO-' || upper(substr(replace(p_user_id::text,'-',''),1,12)),p_user_id,10000000,0)
    returning * into v_account;
    insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type)
    values(v_account.id,'ACCOUNT_OPEN',10000000,10000000,'auth_user');
  end if;
  return to_jsonb(v_account);
end;
$$;

revoke all on function public.provision_user_account(uuid,text) from public,anon,authenticated;
grant execute on function public.provision_user_account(uuid,text) to service_role;

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.favorites enable row level security;
alter table public.holdings enable row level security;
alter table public.orders enable row level security;
alter table public.finance_contracts enable row level security;
alter table public.short_positions enable row level security;
alter table public.cash_ledger enable row level security;
alter table public.futures_positions enable row level security;
alter table public.pending_orders enable row level security;

revoke all on table public.profiles,public.accounts,public.favorites,public.holdings,public.orders,
  public.finance_contracts,public.short_positions,public.cash_ledger,public.futures_positions,public.pending_orders
  from anon,authenticated;

grant select on table public.profiles,public.accounts,public.favorites,public.holdings,public.orders,
  public.finance_contracts,public.short_positions,public.cash_ledger,public.futures_positions,public.pending_orders
  to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using(auth.uid() is not null and id=auth.uid());

drop policy if exists accounts_select_own on public.accounts;
create policy accounts_select_own on public.accounts for select to authenticated
  using(auth.uid() is not null and user_id=auth.uid());

drop policy if exists favorites_select_own on public.favorites;
create policy favorites_select_own on public.favorites for select to authenticated using(
  auth.uid() is not null and exists(select 1 from public.accounts a where a.id=account_id and a.user_id=auth.uid())
);
drop policy if exists holdings_select_own on public.holdings;
create policy holdings_select_own on public.holdings for select to authenticated using(
  auth.uid() is not null and exists(select 1 from public.accounts a where a.id=account_id and a.user_id=auth.uid())
);
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders for select to authenticated using(
  auth.uid() is not null and exists(select 1 from public.accounts a where a.id=account_id and a.user_id=auth.uid())
);
drop policy if exists finance_contracts_select_own on public.finance_contracts;
create policy finance_contracts_select_own on public.finance_contracts for select to authenticated using(
  auth.uid() is not null and exists(select 1 from public.accounts a where a.id=account_id and a.user_id=auth.uid())
);
drop policy if exists short_positions_select_own on public.short_positions;
create policy short_positions_select_own on public.short_positions for select to authenticated using(
  auth.uid() is not null and exists(select 1 from public.accounts a where a.id=account_id and a.user_id=auth.uid())
);
drop policy if exists cash_ledger_select_own on public.cash_ledger;
create policy cash_ledger_select_own on public.cash_ledger for select to authenticated using(
  auth.uid() is not null and exists(select 1 from public.accounts a where a.id=account_id and a.user_id=auth.uid())
);
drop policy if exists futures_positions_select_own on public.futures_positions;
create policy futures_positions_select_own on public.futures_positions for select to authenticated using(
  auth.uid() is not null and exists(select 1 from public.accounts a where a.id=account_id and a.user_id=auth.uid())
);
drop policy if exists pending_orders_select_own on public.pending_orders;
create policy pending_orders_select_own on public.pending_orders for select to authenticated using(
  auth.uid() is not null and exists(select 1 from public.accounts a where a.id=account_id and a.user_id=auth.uid())
);
