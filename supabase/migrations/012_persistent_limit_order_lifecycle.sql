-- 지정가 주문을 대기 목록과 별도로 관리하지 않고, orders의 상태 전이로 함께 추적한다.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED'));

alter table public.pending_orders add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.pending_orders add column if not exists reserved_amount numeric(30,2);
update public.pending_orders set reserved_amount=round(quantity*limit_price,2) where reserved_amount is null;
alter table public.pending_orders alter column reserved_amount set not null;
create unique index if not exists pending_orders_order_id_unique_idx
  on public.pending_orders(order_id) where order_id is not null;

-- 새 지정가 주문은 접수 즉시 orders에도 OPEN 상태로 기록한다.
create or replace function public.create_pending_spot_order(
  p_account_id bigint, p_symbol text, p_category text, p_side text,
  p_quantity numeric, p_limit_price numeric, p_reservation_amount numeric
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account public.accounts%rowtype; v_order public.orders%rowtype;
  v_pending public.pending_orders%rowtype; v_reserved numeric(30,2);
begin
  if p_category not in ('stocks','bonds','crypto') or p_side not in ('BUY','SELL')
    or p_quantity is null or p_quantity<=0 or p_limit_price is null or p_limit_price<=0 then
    raise exception using errcode='22023',message='지정가 주문 정보가 올바르지 않습니다.';
  end if;
  select * into v_account from public.accounts where id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.'; end if;
  if p_side='BUY' then
    select coalesce(sum(reserved_amount),0) into v_reserved
      from public.pending_orders where account_id=p_account_id and side='BUY';
    if p_reservation_amount is null or p_reservation_amount<=0 then
      raise exception using errcode='22023',message='매수 주문금액이 올바르지 않습니다.';
    end if;
    if v_reserved + round(p_reservation_amount,2) > v_account.krw_balance then
      raise exception using errcode='P0001',message='미체결 매수금액을 포함한 주문가능금액이 부족합니다.';
    end if;
  end if;
  insert into public.orders(account_id,symbol,category,side,order_type,quantity,requested_price,
    execution_price,total_amount,status,filled_quantity,remaining_quantity,cancelled_quantity)
  values(p_account_id,p_symbol,p_category,p_side,'LIMIT',p_quantity,p_limit_price,p_limit_price,0,
    'OPEN',0,p_quantity,0) returning * into v_order;
  insert into public.pending_orders(account_id,symbol,category,side,quantity,limit_price,reserved_amount,order_id)
  values(p_account_id,p_symbol,p_category,p_side,p_quantity,p_limit_price,round(p_reservation_amount,2),v_order.id) returning * into v_pending;
  return jsonb_build_object('order',to_jsonb(v_order),'pending_order',to_jsonb(v_pending));
end; $$;
revoke all on function public.create_pending_spot_order(bigint,text,text,text,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.create_pending_spot_order(bigint,text,text,text,numeric,numeric,numeric) to service_role;

-- 기존 즉시 체결 함수와 분리해, OPEN 주문을 동일한 ID로 FILLED 상태로 바꾸는 경로를 제공한다.
create or replace function public.place_pending_spot_order(
  p_account_id bigint, p_pending_order_id uuid, p_execution_price numeric
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype; v_account public.accounts%rowtype;
  v_holding public.holdings%rowtype; v_short public.short_positions%rowtype;
  v_contract public.finance_contracts%rowtype; v_order public.orders%rowtype;
  v_result jsonb;
  v_total numeric(30,2); v_used numeric(30,2); v_owned numeric(30,8):=0;
  v_borrowed numeric(30,8):=0; v_covered numeric(30,8):=0; v_long numeric(30,8):=0;
  v_next numeric(30,8); v_avg numeric(30,8); v_holding_json jsonb; v_short_json jsonb;
begin
  select * into v_pending from public.pending_orders
    where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.'; end if;
  if (v_pending.side='BUY' and p_execution_price>v_pending.limit_price)
    or (v_pending.side='SELL' and p_execution_price<v_pending.limit_price) then
    raise exception using errcode='P0001',message='아직 지정가 체결 조건에 도달하지 않았습니다.';
  end if;
  -- 011 이전 대기 주문도 호환성을 위해 기존 체결 경로를 사용한다.
  if v_pending.order_id is null then
    v_result:=public.place_spot_order(v_pending.account_id,v_pending.symbol,v_pending.category,
      v_pending.side,'LIMIT',v_pending.quantity,v_pending.limit_price,p_execution_price);
    delete from public.pending_orders where id=v_pending.id;
    return v_result;
  end if;
  select * into v_account from public.accounts where id=p_account_id for update;
  select * into v_order from public.orders where id=v_pending.order_id and account_id=p_account_id for update;
  if v_order.status<>'OPEN' then raise exception using errcode='P0001',message='이미 처리된 주문입니다.'; end if;
  v_total:=round(v_pending.quantity*p_execution_price,2);
  select * into v_holding from public.holdings where account_id=p_account_id and symbol=v_pending.symbol for update;
  select * into v_short from public.short_positions where account_id=p_account_id and symbol=v_pending.symbol for update;
  if v_pending.side='BUY' then
    if v_account.krw_balance<v_total then raise exception using errcode='P0001',message='잔고가 부족합니다.'; end if;
    v_covered:=least(coalesce(v_short.quantity,0),v_pending.quantity); v_long:=v_pending.quantity-v_covered;
    update public.accounts set krw_balance=krw_balance-v_total,updated_at=now() where id=p_account_id returning * into v_account;
    if v_covered>0 then
      if v_short.quantity=v_covered then delete from public.short_positions where account_id=p_account_id and symbol=v_pending.symbol;
      else update public.short_positions set quantity=quantity-v_covered,updated_at=now() where account_id=p_account_id and symbol=v_pending.symbol; end if;
    end if;
    if v_long>0 then
      if v_holding.id is null then insert into public.holdings(account_id,symbol,category,quantity,avg_price)
        values(p_account_id,v_pending.symbol,v_pending.category,v_long,p_execution_price);
      else v_next:=v_holding.quantity+v_long; v_avg:=((v_holding.avg_price*v_holding.quantity)+(p_execution_price*v_long))/v_next;
        update public.holdings set quantity=v_next,avg_price=v_avg,category=v_pending.category,updated_at=now() where id=v_holding.id; end if;
    end if;
  else
    v_owned:=least(coalesce(v_holding.quantity,0),v_pending.quantity); v_borrowed:=v_pending.quantity-v_owned;
    if v_borrowed>0 then
      if v_pending.category<>'stocks' then raise exception using errcode='P0001',message='보유수량이 부족합니다.'; end if;
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
        values(p_account_id,v_pending.symbol,v_borrowed,p_execution_price);
      else v_next:=v_short.quantity+v_borrowed; v_avg:=((v_short.avg_price*v_short.quantity)+(p_execution_price*v_borrowed))/v_next;
        update public.short_positions set quantity=v_next,avg_price=v_avg,updated_at=now() where account_id=p_account_id and symbol=v_pending.symbol; end if;
    end if;
  end if;
  update public.orders set execution_price=p_execution_price,total_amount=v_total,status='FILLED',
    filled_quantity=quantity,remaining_quantity=0,cancelled_quantity=0,borrowed_quantity=v_borrowed,
    covered_quantity=v_covered,updated_at=now() where id=v_order.id returning * into v_order;
  insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type,reference_id)
  values(p_account_id,case when v_pending.side='BUY' then 'SPOT_BUY' else 'SPOT_SELL' end,
    case when v_pending.side='BUY' then -v_total else v_total end,v_account.krw_balance,'order',v_order.id::text);
  delete from public.pending_orders where id=v_pending.id;
  select to_jsonb(h) into v_holding_json from public.holdings h where account_id=p_account_id and symbol=v_pending.symbol;
  select to_jsonb(s) into v_short_json from public.short_positions s where account_id=p_account_id and symbol=v_pending.symbol;
  return jsonb_build_object('account',to_jsonb(v_account),'holding',v_holding_json,
    'short_position',v_short_json,'order',to_jsonb(v_order));
end; $$;
revoke all on function public.place_pending_spot_order(bigint,uuid,numeric) from public,anon,authenticated;
grant execute on function public.place_pending_spot_order(bigint,uuid,numeric) to service_role;

-- 취소도 반드시 상태 이벤트를 남긴다. 011 이전에 남은 legacy 대기 주문은 삭제만 수행한다.
create or replace function public.cancel_pending_spot_order(p_account_id bigint,p_pending_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype; v_order public.orders%rowtype;
begin
  select * into v_pending from public.pending_orders
    where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.'; end if;
  if v_pending.order_id is not null then
    update public.orders set status='CANCELLED',cancelled_quantity=quantity,
      remaining_quantity=0,updated_at=now()
      where id=v_pending.order_id and account_id=p_account_id returning * into v_order;
  end if;
  delete from public.pending_orders where id=v_pending.id;
  return jsonb_build_object('pending_order_id',v_pending.id,'order',case when v_order.id is null then null else to_jsonb(v_order) end);
end; $$;
revoke all on function public.cancel_pending_spot_order(bigint,uuid) from public,anon,authenticated;
grant execute on function public.cancel_pending_spot_order(bigint,uuid) to service_role;

-- 접수 자체도 주문 이벤트로 남긴다. (011의 초기 함수는 FILLED만 두 번째 이벤트로 기록했다.)
create or replace function public.record_order_event()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,metadata,created_at)
    values(new.account_id,new.id,'ACCEPTED',0,new.quantity,jsonb_build_object('source','order_insert'),new.created_at);
    if new.status<>'REJECTED' then
      insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,execution_price,metadata,created_at)
      values(new.account_id,new.id,new.status,new.filled_quantity,new.remaining_quantity,
        case when new.status='FILLED' then new.execution_price else null end,jsonb_build_object('source','order_insert'));
    end if;
  elsif new.status is distinct from old.status or new.filled_quantity is distinct from old.filled_quantity or new.remaining_quantity is distinct from old.remaining_quantity then
    insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,execution_price,metadata)
    values(new.account_id,new.id,new.status,new.filled_quantity,new.remaining_quantity,
      case when new.filled_quantity>old.filled_quantity then new.execution_price else null end,jsonb_build_object('source','order_update'));
  end if;
  return new;
end; $$;
