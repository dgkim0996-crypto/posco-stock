create table if not exists public.pending_orders (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references public.accounts(id) on delete cascade,
  symbol text not null,
  category text not null check(category in ('stocks','bonds','crypto')),
  side text not null check(side in ('BUY','SELL')),
  quantity numeric(30,8) not null check(quantity>0),
  limit_price numeric(30,8) not null check(limit_price>0),
  created_at timestamptz not null default now()
);
create index if not exists pending_orders_account_created_idx on public.pending_orders(account_id,created_at desc);
alter table public.pending_orders enable row level security;

create or replace function public.execute_pending_spot_order(p_account_id bigint,p_pending_order_id uuid,p_execution_price numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype;v_result jsonb;
begin
  select * into v_pending from public.pending_orders where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.';end if;
  if (v_pending.side='BUY' and p_execution_price>v_pending.limit_price)
    or (v_pending.side='SELL' and p_execution_price<v_pending.limit_price)
    then raise exception using errcode='P0001',message='아직 지정가 체결 조건에 도달하지 않았습니다.';end if;
  v_result:=public.place_spot_order(v_pending.account_id,v_pending.symbol,v_pending.category,v_pending.side,'LIMIT',v_pending.quantity,v_pending.limit_price,p_execution_price);
  delete from public.pending_orders where id=v_pending.id;
  return v_result;
end;$$;
revoke all on function public.execute_pending_spot_order(bigint,uuid,numeric)from public,anon,authenticated;
grant execute on function public.execute_pending_spot_order(bigint,uuid,numeric)to service_role;

create or replace function public.reset_demo_account(p_account_id bigint,p_starting_cash numeric default 10000000)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account public.accounts%rowtype;
begin
  perform 1 from public.accounts where id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.';end if;
  delete from public.pending_orders where account_id=p_account_id;
  delete from public.orders where account_id=p_account_id;
  delete from public.holdings where account_id=p_account_id;
  delete from public.short_positions where account_id=p_account_id;
  delete from public.futures_positions where account_id=p_account_id;
  delete from public.finance_contracts where account_id=p_account_id;
  delete from public.cash_ledger where account_id=p_account_id;
  update public.accounts set krw_balance=p_starting_cash,usd_balance=0,updated_at=now()
  where id=p_account_id returning * into v_account;
  insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type)
  values(p_account_id,'ACCOUNT_RESET',p_starting_cash,p_starting_cash,'account');
  return to_jsonb(v_account);
end;$$;
revoke all on function public.reset_demo_account(bigint,numeric)from public,anon,authenticated;
grant execute on function public.reset_demo_account(bigint,numeric)to service_role;
