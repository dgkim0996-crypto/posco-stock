alter table public.orders add column if not exists borrowed_quantity numeric(30,8) not null default 0;
alter table public.orders add column if not exists covered_quantity numeric(30,8) not null default 0;

create or replace function public.place_spot_order(
  p_account_id bigint, p_symbol text, p_category text, p_side text,
  p_order_type text, p_quantity numeric, p_requested_price numeric, p_execution_price numeric
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_account public.accounts%rowtype; v_holding public.holdings%rowtype;
  v_short public.short_positions%rowtype; v_contract public.finance_contracts%rowtype;
  v_order public.orders%rowtype; v_total numeric(30,2); v_used numeric(30,2);
  v_owned numeric(30,8):=0; v_borrowed numeric(30,8):=0;
  v_covered numeric(30,8):=0; v_long numeric(30,8):=0; v_next numeric(30,8);
  v_avg numeric(30,8); v_holding_json jsonb; v_short_json jsonb;
begin
  if p_category not in ('stocks','bonds','crypto') or p_side not in ('BUY','SELL')
    or p_order_type not in ('MARKET','LIMIT') then raise exception using errcode='22023',message='지원하지 않는 주문입니다.'; end if;
  if p_quantity is null or p_quantity<=0 or p_execution_price is null or p_execution_price<=0
    then raise exception using errcode='22023',message='수량과 체결가는 0보다 커야 합니다.'; end if;
  select * into v_account from public.accounts where id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.'; end if;
  v_total:=round(p_quantity*p_execution_price,2);
  select * into v_holding from public.holdings where account_id=p_account_id and symbol=p_symbol for update;
  select * into v_short from public.short_positions where account_id=p_account_id and symbol=p_symbol for update;

  if p_side='BUY' then
    if v_account.krw_balance<v_total then raise exception using errcode='P0001',message='잔고가 부족합니다.'; end if;
    v_covered:=least(coalesce(v_short.quantity,0),p_quantity); v_long:=p_quantity-v_covered;
    update public.accounts set krw_balance=krw_balance-v_total,updated_at=now() where id=p_account_id returning * into v_account;
    if v_covered>0 then
      if v_short.quantity=v_covered then delete from public.short_positions where account_id=p_account_id and symbol=p_symbol;
      else update public.short_positions set quantity=quantity-v_covered,updated_at=now() where account_id=p_account_id and symbol=p_symbol; end if;
    end if;
    if v_long>0 then
      if v_holding.id is null then insert into public.holdings(account_id,symbol,category,quantity,avg_price)
        values(p_account_id,p_symbol,p_category,v_long,p_execution_price);
      else v_next:=v_holding.quantity+v_long; v_avg:=((v_holding.avg_price*v_holding.quantity)+(p_execution_price*v_long))/v_next;
        update public.holdings set quantity=v_next,avg_price=v_avg,category=p_category,updated_at=now() where id=v_holding.id; end if;
    end if;
  else
    v_owned:=least(coalesce(v_holding.quantity,0),p_quantity); v_borrowed:=p_quantity-v_owned;
    if v_borrowed>0 then
      if p_category<>'stocks' then raise exception using errcode='P0001',message='보유수량이 부족합니다.'; end if;
      select * into v_contract from public.finance_contracts where account_id=p_account_id and product_type='lending' for update;
      if v_contract.account_id is null or not v_contract.active then raise exception using errcode='P0001',message='대주거래 실행이 필요합니다.'; end if;
      select coalesce(sum(quantity*avg_price),0) into v_used from public.short_positions where account_id=p_account_id;
      if v_used+(v_borrowed*p_execution_price)>v_contract.limit_amount then raise exception using errcode='P0001',message='대주한도를 초과했습니다.'; end if;
    end if;
    update public.accounts set krw_balance=krw_balance+v_total,updated_at=now() where id=p_account_id returning * into v_account;
    if v_owned>0 then
      if v_holding.quantity=v_owned then delete from public.holdings where id=v_holding.id;
      else update public.holdings set quantity=quantity-v_owned,updated_at=now() where id=v_holding.id; end if;
    end if;
    if v_borrowed>0 then
      if v_short.account_id is null then insert into public.short_positions(account_id,symbol,quantity,avg_price)
        values(p_account_id,p_symbol,v_borrowed,p_execution_price);
      else v_next:=v_short.quantity+v_borrowed; v_avg:=((v_short.avg_price*v_short.quantity)+(p_execution_price*v_borrowed))/v_next;
        update public.short_positions set quantity=v_next,avg_price=v_avg,updated_at=now() where account_id=p_account_id and symbol=p_symbol; end if;
    end if;
  end if;

  insert into public.orders(account_id,symbol,category,side,order_type,quantity,requested_price,execution_price,total_amount,borrowed_quantity,covered_quantity)
  values(p_account_id,p_symbol,p_category,p_side,p_order_type,p_quantity,p_requested_price,p_execution_price,v_total,v_borrowed,v_covered) returning * into v_order;
  insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type,reference_id)
  values(p_account_id,case when p_side='BUY' then 'SPOT_BUY' else 'SPOT_SELL' end,case when p_side='BUY' then -v_total else v_total end,v_account.krw_balance,'order',v_order.id::text);
  select to_jsonb(h) into v_holding_json from public.holdings h where account_id=p_account_id and symbol=p_symbol;
  select to_jsonb(s) into v_short_json from public.short_positions s where account_id=p_account_id and symbol=p_symbol;
  return jsonb_build_object('account',to_jsonb(v_account),'holding',v_holding_json,'short_position',v_short_json,'order',to_jsonb(v_order));
end; $$;

revoke all on function public.place_spot_order(bigint,text,text,text,text,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.place_spot_order(bigint,text,text,text,text,numeric,numeric,numeric) to service_role;
