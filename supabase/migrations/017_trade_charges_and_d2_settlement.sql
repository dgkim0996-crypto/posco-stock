-- 모의 위탁수수료·증권거래세와 영업일 기준 D+2 결제 예정 원장.
create table if not exists public.trade_charge_policies (
  code text primary key,
  name text not null,
  fee_rate numeric(12,8) not null check(fee_rate>=0),
  sell_tax_rate numeric(12,8) not null check(sell_tax_rate>=0),
  settlement_days integer not null default 2 check(settlement_days>=0),
  updated_at timestamptz not null default now()
);
insert into public.trade_charge_policies(code,name,fee_rate,sell_tax_rate,settlement_days) values
  ('KR_STOCK','국내주식 모의요율',0.00015,0.0015,2),
  ('KR_ETF','국내 ETF 모의요율',0.00015,0,2),
  ('US_STOCK','해외주식 모의요율',0.0007,0,2),
  ('OTHER','기타 현물 모의요율',0.00015,0,2)
on conflict(code) do nothing;

create table if not exists public.trade_charge_overrides (
  symbol text primary key,
  policy_code text not null references public.trade_charge_policies(code),
  created_at timestamptz not null default now()
);
insert into public.trade_charge_overrides(symbol,policy_code) values
  ('360750','KR_ETF'),('069500','KR_ETF'),('133690','KR_ETF'),('305720','KR_ETF'),
  ('QQQ','US_STOCK'),('SPY','US_STOCK')
on conflict(symbol) do update set policy_code=excluded.policy_code;

create table if not exists public.market_holidays (
  holiday_date date primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create or replace function public.add_business_days(p_start date,p_days integer)
returns date language plpgsql stable set search_path=public as $$
declare v_date date:=p_start; v_added integer:=0;
begin
  while v_added<p_days loop
    v_date:=v_date+1;
    if extract(isodow from v_date)<6 and not exists(select 1 from public.market_holidays where holiday_date=v_date) then
      v_added:=v_added+1;
    end if;
  end loop;
  return v_date;
end; $$;

create table if not exists public.trade_settlements (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references public.accounts(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  cash_ledger_id bigint not null unique references public.cash_ledger(id) on delete restrict,
  side text not null check(side in ('BUY','SELL')),
  symbol text not null,
  trade_date date not null,
  settlement_date date not null,
  gross_amount numeric(30,2) not null check(gross_amount>=0),
  fee_amount numeric(30,2) not null check(fee_amount>=0),
  tax_amount numeric(30,2) not null check(tax_amount>=0),
  net_amount numeric(30,2) not null,
  status text not null default 'PENDING' check(status in ('PENDING','SETTLED')),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists trade_settlements_account_date_idx
  on public.trade_settlements(account_id,settlement_date,status,created_at desc);

alter table public.orders add column if not exists fee_amount numeric(30,2) not null default 0;
alter table public.orders add column if not exists tax_amount numeric(30,2) not null default 0;
alter table public.orders add column if not exists settlement_date date;

create or replace function public.record_trade_charges_and_settlement()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype; v_policy public.trade_charge_policies%rowtype;
  v_policy_code text; v_fee numeric(30,2); v_tax numeric(30,2); v_gross numeric(30,2);
  v_balance numeric(30,2); v_trade_date date; v_settlement_date date; v_group uuid:=gen_random_uuid();
begin
  if new.event_type not in ('SPOT_BUY','SPOT_SELL') or new.reference_type<>'order' then return new; end if;
  select * into v_order from public.orders where id=new.reference_id::uuid for update;
  if not found then return new; end if;
  select policy_code into v_policy_code from public.trade_charge_overrides where symbol=v_order.symbol;
  if v_policy_code is null then
    v_policy_code:=case when v_order.category<>'stocks' then 'OTHER'
      when v_order.symbol~'^[0-9]{6}$' then 'KR_STOCK' else 'US_STOCK' end;
  end if;
  select * into v_policy from public.trade_charge_policies where code=v_policy_code;
  v_gross:=abs(new.amount);
  v_fee:=round(v_gross*v_policy.fee_rate,2);
  v_tax:=case when v_order.side='SELL' then round(v_gross*v_policy.sell_tax_rate,2) else 0 end;
  select krw_balance into v_balance from public.accounts where id=new.account_id for update;
  if v_balance<v_fee+v_tax then raise exception using errcode='P0001',message='수수료와 세금을 포함한 주문가능금액이 부족합니다.'; end if;
  update public.accounts set krw_balance=krw_balance-v_fee-v_tax,updated_at=now()
    where id=new.account_id returning krw_balance into v_balance;
  if v_fee>0 then
    insert into public.cash_ledger(account_id,event_type,amount,balance_before,balance_after,reference_type,reference_id,entry_group_id,metadata)
    values(new.account_id,'TRADE_FEE',-v_fee,v_balance+v_fee+v_tax,v_balance+v_tax,'order',v_order.id::text,v_group,
      jsonb_build_object('cash_ledger_id',new.id,'policy',v_policy.code));
  end if;
  if v_tax>0 then
    insert into public.cash_ledger(account_id,event_type,amount,balance_before,balance_after,reference_type,reference_id,entry_group_id,metadata)
    values(new.account_id,'TRADE_TAX',-v_tax,v_balance+v_tax,v_balance,'order',v_order.id::text,v_group,
      jsonb_build_object('cash_ledger_id',new.id,'policy',v_policy.code));
  end if;
  v_trade_date:=(new.created_at at time zone 'Asia/Seoul')::date;
  v_settlement_date:=public.add_business_days(v_trade_date,v_policy.settlement_days);
  insert into public.trade_settlements(account_id,order_id,cash_ledger_id,side,symbol,trade_date,settlement_date,
    gross_amount,fee_amount,tax_amount,net_amount)
  values(new.account_id,v_order.id,new.id,v_order.side,v_order.symbol,v_trade_date,v_settlement_date,v_gross,v_fee,v_tax,
    case when v_order.side='BUY' then -(v_gross+v_fee) else v_gross-v_fee-v_tax end);
  update public.orders set fee_amount=fee_amount+v_fee,tax_amount=tax_amount+v_tax,
    settlement_date=greatest(coalesce(settlement_date,v_settlement_date),v_settlement_date) where id=v_order.id;
  return new;
end; $$;
drop trigger if exists cash_ledger_trade_charges on public.cash_ledger;
create trigger cash_ledger_trade_charges after insert on public.cash_ledger
for each row execute function public.record_trade_charges_and_settlement();

create or replace function public.process_due_trade_settlements(p_account_id bigint default null,p_as_of date default null)
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  update public.trade_settlements set status='SETTLED',settled_at=now()
  where status='PENDING' and settlement_date<=coalesce(p_as_of,(now() at time zone 'Asia/Seoul')::date)
    and (p_account_id is null or account_id=p_account_id);
  get diagnostics v_count=row_count;
  return v_count;
end; $$;

alter table public.trade_settlements enable row level security;
alter table public.trade_charge_policies enable row level security;
alter table public.trade_charge_overrides enable row level security;
alter table public.market_holidays enable row level security;
revoke all on table public.trade_settlements,public.trade_charge_policies,public.trade_charge_overrides,public.market_holidays from anon,authenticated;
grant select on table public.trade_settlements,public.trade_charge_policies to authenticated;
drop policy if exists trade_settlements_select_own on public.trade_settlements;
create policy trade_settlements_select_own on public.trade_settlements for select to authenticated using(
  auth.uid() is not null and exists(select 1 from public.accounts a where a.id=account_id and a.user_id=auth.uid())
);
drop policy if exists trade_charge_policies_read on public.trade_charge_policies;
create policy trade_charge_policies_read on public.trade_charge_policies for select to authenticated using(true);
revoke all on function public.process_due_trade_settlements(bigint,date) from public,anon,authenticated;
grant execute on function public.process_due_trade_settlements(bigint,date) to service_role;
