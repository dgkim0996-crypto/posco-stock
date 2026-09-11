-- 2026년 국내 주식 세율을 시장별로 반영하고 실제 차감 세액을 구성 항목별로 보존한다.
alter table public.trade_charge_policies
  add column if not exists transaction_tax_rate numeric(12,8) not null default 0 check(transaction_tax_rate>=0),
  add column if not exists agricultural_tax_rate numeric(12,8) not null default 0 check(agricultural_tax_rate>=0),
  add column if not exists effective_from date not null default '2026-01-01';

update public.trade_charge_policies set
  name='국내 KOSPI 2026 모의요율', sell_tax_rate=0.002,
  transaction_tax_rate=0.0005, agricultural_tax_rate=0.0015,
  effective_from='2026-01-01', updated_at=now()
where code='KR_STOCK';

insert into public.trade_charge_policies(
  code,name,fee_rate,sell_tax_rate,settlement_days,
  transaction_tax_rate,agricultural_tax_rate,effective_from
) values (
  'KR_KOSDAQ_STOCK','국내 KOSDAQ 2026 모의요율',0.00015,0.002,2,
  0.002,0,'2026-01-01'
) on conflict(code) do update set
  name=excluded.name,fee_rate=excluded.fee_rate,sell_tax_rate=excluded.sell_tax_rate,
  settlement_days=excluded.settlement_days,transaction_tax_rate=excluded.transaction_tax_rate,
  agricultural_tax_rate=excluded.agricultural_tax_rate,effective_from=excluded.effective_from,updated_at=now();

update public.trade_charge_policies set
  transaction_tax_rate=0,agricultural_tax_rate=0,effective_from='2026-01-01',updated_at=now()
where code in ('KR_ETF','US_STOCK','OTHER');

insert into public.trade_charge_overrides(symbol,policy_code) values
  ('009520','KR_KOSDAQ_STOCK')
on conflict(symbol) do update set policy_code=excluded.policy_code;

alter table public.orders
  add column if not exists transaction_tax_amount numeric(30,2) not null default 0,
  add column if not exists agricultural_tax_amount numeric(30,2) not null default 0;
alter table public.trade_settlements
  add column if not exists transaction_tax_amount numeric(30,2) not null default 0,
  add column if not exists agricultural_tax_amount numeric(30,2) not null default 0;

create or replace function public.record_trade_charges_and_settlement()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype; v_policy public.trade_charge_policies%rowtype;
  v_policy_code text; v_fee numeric(30,2); v_transaction_tax numeric(30,2);
  v_agricultural_tax numeric(30,2); v_tax numeric(30,2); v_gross numeric(30,2);
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
  v_transaction_tax:=case when v_order.side='SELL' then round(v_gross*v_policy.transaction_tax_rate,2) else 0 end;
  v_agricultural_tax:=case when v_order.side='SELL' then round(v_gross*v_policy.agricultural_tax_rate,2) else 0 end;
  v_tax:=v_transaction_tax+v_agricultural_tax;
  select krw_balance into v_balance from public.accounts where id=new.account_id for update;
  if v_balance<v_fee+v_tax then raise exception using errcode='P0001',message='수수료와 세금을 포함한 주문가능금액이 부족합니다.'; end if;
  update public.accounts set krw_balance=krw_balance-v_fee-v_tax,updated_at=now()
    where id=new.account_id returning krw_balance into v_balance;
  if v_fee>0 then
    insert into public.cash_ledger(account_id,event_type,amount,balance_before,balance_after,reference_type,reference_id,entry_group_id,metadata)
    values(new.account_id,'TRADE_FEE',-v_fee,v_balance+v_fee+v_tax,v_balance+v_tax,'order',v_order.id::text,v_group,
      jsonb_build_object('cash_ledger_id',new.id,'policy',v_policy.code,'rate',v_policy.fee_rate));
  end if;
  if v_tax>0 then
    insert into public.cash_ledger(account_id,event_type,amount,balance_before,balance_after,reference_type,reference_id,entry_group_id,metadata)
    values(new.account_id,'TRADE_TAX',-v_tax,v_balance+v_tax,v_balance,'order',v_order.id::text,v_group,
      jsonb_build_object('cash_ledger_id',new.id,'policy',v_policy.code,
        'transaction_tax_amount',v_transaction_tax,'agricultural_tax_amount',v_agricultural_tax,
        'transaction_tax_rate',v_policy.transaction_tax_rate,'agricultural_tax_rate',v_policy.agricultural_tax_rate));
  end if;
  v_trade_date:=(new.created_at at time zone 'Asia/Seoul')::date;
  v_settlement_date:=public.add_business_days(v_trade_date,v_policy.settlement_days);
  insert into public.trade_settlements(account_id,order_id,cash_ledger_id,side,symbol,trade_date,settlement_date,
    gross_amount,fee_amount,tax_amount,transaction_tax_amount,agricultural_tax_amount,net_amount)
  values(new.account_id,v_order.id,new.id,v_order.side,v_order.symbol,v_trade_date,v_settlement_date,v_gross,v_fee,v_tax,
    v_transaction_tax,v_agricultural_tax,
    case when v_order.side='BUY' then -(v_gross+v_fee) else v_gross-v_fee-v_tax end);
  update public.orders set fee_amount=fee_amount+v_fee,tax_amount=tax_amount+v_tax,
    transaction_tax_amount=transaction_tax_amount+v_transaction_tax,
    agricultural_tax_amount=agricultural_tax_amount+v_agricultural_tax,
    settlement_date=greatest(coalesce(settlement_date,v_settlement_date),v_settlement_date) where id=v_order.id;
  return new;
end; $$;
