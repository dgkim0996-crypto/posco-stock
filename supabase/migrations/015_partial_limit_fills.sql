-- 지정가 주문을 잔여수량 단위로 여러 번 체결하고 각 체결을 주문 이벤트와 원장에 남긴다.
-- 주문에는 누적 평균 체결가를, 이벤트에는 해당 회차의 실제 체결가를 기록한다.
create or replace function public.record_order_event()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_event_price numeric; v_event_type text;
begin
  if tg_op='INSERT' then
    insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,metadata,created_at)
    values(new.account_id,new.id,'ACCEPTED',0,new.quantity,jsonb_build_object('source','order_insert'),new.created_at);
    if new.status<>'REJECTED' then
      insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,execution_price,metadata,created_at)
      values(new.account_id,new.id,new.status,new.filled_quantity,new.remaining_quantity,
        case when new.status='FILLED' then new.execution_price else null end,jsonb_build_object('source','order_insert'),new.created_at);
    end if;
  elsif new.status is distinct from old.status or new.filled_quantity is distinct from old.filled_quantity
    or new.remaining_quantity is distinct from old.remaining_quantity then
    v_event_type:=coalesce(nullif(current_setting('app.order_event_type',true),''),new.status);
    v_event_price:=case when new.filled_quantity>old.filled_quantity then
      coalesce(nullif(current_setting('app.order_execution_price',true),'')::numeric,new.execution_price) else null end;
    insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,execution_price,metadata)
    values(new.account_id,new.id,v_event_type,new.filled_quantity,new.remaining_quantity,v_event_price,
      jsonb_build_object('source','order_update','fill_quantity',greatest(new.filled_quantity-old.filled_quantity,0)));
  end if;
  return new;
end; $$;

create or replace function public.place_pending_spot_order(
  p_account_id bigint, p_pending_order_id uuid, p_execution_price numeric,
  p_fill_quantity numeric default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype; v_account public.accounts%rowtype;
  v_holding public.holdings%rowtype; v_short public.short_positions%rowtype;
  v_contract public.finance_contracts%rowtype; v_order public.orders%rowtype;
  v_fill numeric(30,8); v_total numeric(30,2); v_used numeric(30,2);
  v_owned numeric(30,8):=0; v_borrowed numeric(30,8):=0;
  v_covered numeric(30,8):=0; v_long numeric(30,8):=0;
  v_next numeric(30,8); v_avg numeric(30,8); v_remaining numeric(30,8);
  v_holding_json jsonb; v_short_json jsonb;
begin
  select * into v_pending from public.pending_orders
    where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.'; end if;
  if v_pending.order_id is null then
    raise exception using errcode='P0001',message='기존 주문은 취소 후 다시 접수해 주세요.';
  end if;
  if p_execution_price is null or p_execution_price<=0
    or (v_pending.side='BUY' and p_execution_price>v_pending.limit_price)
    or (v_pending.side='SELL' and p_execution_price<v_pending.limit_price) then
    raise exception using errcode='P0001',message='아직 지정가 체결 조건에 도달하지 않았습니다.';
  end if;
  v_fill:=coalesce(p_fill_quantity,v_pending.quantity);
  if v_fill<=0 or v_fill>v_pending.quantity then
    raise exception using errcode='22023',message='부분체결 수량은 0보다 크고 잔여수량 이하여야 합니다.';
  end if;

  select * into v_account from public.accounts where id=p_account_id for update;
  select * into v_order from public.orders where id=v_pending.order_id and account_id=p_account_id for update;
  if v_order.status not in ('OPEN','PARTIALLY_FILLED') then
    raise exception using errcode='P0001',message='이미 처리된 주문입니다.';
  end if;
  v_total:=round(v_fill*p_execution_price,2);
  v_remaining:=v_pending.quantity-v_fill;
  select * into v_holding from public.holdings where account_id=p_account_id and symbol=v_pending.symbol for update;
  select * into v_short from public.short_positions where account_id=p_account_id and symbol=v_pending.symbol for update;

  if v_pending.side='BUY' then
    if v_account.krw_balance<v_total then raise exception using errcode='P0001',message='잔고가 부족합니다.'; end if;
    v_covered:=least(coalesce(v_short.quantity,0),v_fill); v_long:=v_fill-v_covered;
    update public.accounts set krw_balance=krw_balance-v_total,updated_at=now()
      where id=p_account_id returning * into v_account;
    if v_covered>0 then
      if v_short.quantity=v_covered then delete from public.short_positions where account_id=p_account_id and symbol=v_pending.symbol;
      else update public.short_positions set quantity=quantity-v_covered,updated_at=now()
        where account_id=p_account_id and symbol=v_pending.symbol; end if;
    end if;
    if v_long>0 then
      if v_holding.id is null then
        insert into public.holdings(account_id,symbol,category,quantity,avg_price)
          values(p_account_id,v_pending.symbol,v_pending.category,v_long,p_execution_price);
      else
        v_next:=v_holding.quantity+v_long;
        v_avg:=((v_holding.avg_price*v_holding.quantity)+(p_execution_price*v_long))/v_next;
        update public.holdings set quantity=v_next,avg_price=v_avg,category=v_pending.category,updated_at=now()
          where id=v_holding.id;
      end if;
    end if;
  else
    v_owned:=least(coalesce(v_holding.quantity,0),v_fill); v_borrowed:=v_fill-v_owned;
    if v_borrowed>0 then
      if v_pending.category<>'stocks' then raise exception using errcode='P0001',message='보유수량이 부족합니다.'; end if;
      select * into v_contract from public.finance_contracts
        where account_id=p_account_id and product_type='lending' for update;
      if v_contract.account_id is null or not v_contract.active then
        raise exception using errcode='P0001',message='대주거래 실행이 필요합니다.';
      end if;
      select coalesce(sum(quantity*avg_price),0) into v_used from public.short_positions where account_id=p_account_id;
      if v_used+(v_borrowed*p_execution_price)>v_contract.limit_amount then
        raise exception using errcode='P0001',message='대주한도를 초과했습니다.';
      end if;
    end if;
    update public.accounts set krw_balance=krw_balance+v_total,updated_at=now()
      where id=p_account_id returning * into v_account;
    if v_owned>0 then
      if v_holding.quantity=v_owned then delete from public.holdings where id=v_holding.id;
      else update public.holdings set quantity=quantity-v_owned,updated_at=now() where id=v_holding.id; end if;
    end if;
    if v_borrowed>0 then
      if v_short.account_id is null then
        insert into public.short_positions(account_id,symbol,quantity,avg_price)
          values(p_account_id,v_pending.symbol,v_borrowed,p_execution_price);
      else
        v_next:=v_short.quantity+v_borrowed;
        v_avg:=((v_short.avg_price*v_short.quantity)+(p_execution_price*v_borrowed))/v_next;
        update public.short_positions set quantity=v_next,avg_price=v_avg,updated_at=now()
          where account_id=p_account_id and symbol=v_pending.symbol;
      end if;
    end if;
  end if;

  perform set_config('app.order_execution_price',p_execution_price::text,true);
  update public.orders set
    execution_price=round(((coalesce(total_amount,0)) + v_total)/(filled_quantity+v_fill),8),
    total_amount=coalesce(total_amount,0)+v_total,
    status=case when v_remaining=0 then 'FILLED' else 'PARTIALLY_FILLED' end,
    filled_quantity=filled_quantity+v_fill,remaining_quantity=v_remaining,cancelled_quantity=0,
    borrowed_quantity=coalesce(borrowed_quantity,0)+v_borrowed,
    covered_quantity=coalesce(covered_quantity,0)+v_covered,updated_at=now()
    where id=v_order.id returning * into v_order;
  insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type,reference_id)
    values(p_account_id,case when v_pending.side='BUY' then 'SPOT_BUY' else 'SPOT_SELL' end,
      case when v_pending.side='BUY' then -v_total else v_total end,v_account.krw_balance,'order',v_order.id::text);
  if v_remaining=0 then
    delete from public.pending_orders where id=v_pending.id;
  else
    update public.pending_orders set quantity=v_remaining,
      reserved_amount=round(v_remaining*limit_price,2) where id=v_pending.id;
  end if;
  select to_jsonb(h) into v_holding_json from public.holdings h
    where account_id=p_account_id and symbol=v_pending.symbol;
  select to_jsonb(s) into v_short_json from public.short_positions s
    where account_id=p_account_id and symbol=v_pending.symbol;
  return jsonb_build_object('account',to_jsonb(v_account),'holding',v_holding_json,
    'short_position',v_short_json,'order',to_jsonb(v_order));
end; $$;
revoke all on function public.place_pending_spot_order(bigint,uuid,numeric,numeric) from public,anon,authenticated;
grant execute on function public.place_pending_spot_order(bigint,uuid,numeric,numeric) to service_role;

-- 부분체결 뒤 정정은 이미 체결된 수량을 보존하고 잔여수량만 바꾼다.
create or replace function public.amend_pending_spot_order(
  p_account_id bigint, p_pending_order_id uuid, p_quantity numeric, p_limit_price numeric,
  p_reservation_amount numeric
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype; v_account public.accounts%rowtype;
  v_order public.orders%rowtype; v_other_reserved numeric(30,2);
begin
  if p_quantity is null or p_quantity<=0 or p_limit_price is null or p_limit_price<=0
    or p_reservation_amount is null or p_reservation_amount<=0 then
    raise exception using errcode='22023',message='정정 주문 정보가 올바르지 않습니다.';
  end if;
  select * into v_pending from public.pending_orders where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.'; end if;
  select * into v_account from public.accounts where id=p_account_id for update;
  if v_pending.side='BUY' then
    select coalesce(sum(reserved_amount),0) into v_other_reserved from public.pending_orders
      where account_id=p_account_id and side='BUY' and id<>v_pending.id;
    if v_other_reserved+round(p_reservation_amount,2)>v_account.krw_balance then
      raise exception using errcode='P0001',message='미체결 매수금액을 포함한 주문가능금액이 부족합니다.';
    end if;
  end if;
  update public.pending_orders set quantity=p_quantity,limit_price=p_limit_price,
    reserved_amount=round(p_reservation_amount,2) where id=v_pending.id returning * into v_pending;
  if v_pending.order_id is not null then
    perform set_config('app.order_event_type','AMENDED',true);
    update public.orders set quantity=filled_quantity+p_quantity,requested_price=p_limit_price,
      remaining_quantity=p_quantity,updated_at=now()
      where id=v_pending.order_id and status in ('OPEN','PARTIALLY_FILLED') returning * into v_order;
    if not found then raise exception using errcode='P0001',message='정정할 수 없는 주문 상태입니다.'; end if;
    perform set_config('app.order_event_type','',true);
  end if;
  return jsonb_build_object('pending_order',to_jsonb(v_pending),'order',case when v_order.id is null then null else to_jsonb(v_order) end);
end; $$;

-- 취소 시 체결분은 보존하고 아직 체결되지 않은 수량만 취소수량으로 기록한다.
create or replace function public.cancel_pending_spot_order(p_account_id bigint,p_pending_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype; v_order public.orders%rowtype;
begin
  select * into v_pending from public.pending_orders where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.'; end if;
  if v_pending.order_id is not null then
    update public.orders set status='CANCELLED',cancelled_quantity=v_pending.quantity,
      remaining_quantity=0,updated_at=now()
      where id=v_pending.order_id and account_id=p_account_id
        and status in ('OPEN','PARTIALLY_FILLED') returning * into v_order;
    if not found then raise exception using errcode='P0001',message='취소할 수 없는 주문 상태입니다.'; end if;
  end if;
  delete from public.pending_orders where id=v_pending.id;
  return jsonb_build_object('pending_order_id',v_pending.id,'order',case when v_order.id is null then null else to_jsonb(v_order) end);
end; $$;
