-- 선물 청산 정산 보완.
-- 1) 청산 손실이 미체결 매수 예약금까지 써야 하면 가장 최근 미체결 매수부터 필요한 만큼 취소해 예약을 푼다.
--    020 protect_reserved_cash 때문에 손실 청산·강제청산이 실패하던 문제를 고친다.
--    취소 이벤트는 주문 트리거가 CANCELLED로 남기고, 취소 목록은 현금원장 metadata와 RPC 결과에도 기록한다.
-- 2) 강제청산 손실이 증거금+예수금을 넘으면 부족분을 탕감하지 않고 미수(finance_contracts 'margin') 부채로 기록한다.
-- 3) 서버가 전달한 승수는 원화 환산값(해외선물은 달러 승수×모의환율)이며, 현재가 NaN/Infinity는 거부한다.

create or replace function public.release_reserved_cash_for_futures(p_account_id bigint,p_cash_after numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_reserved numeric;v_pending record;v_cancelled jsonb:='[]'::jsonb;
begin
  select coalesce(sum(reserved_amount),0) into v_reserved from public.pending_orders
    where account_id=p_account_id and side='BUY';
  for v_pending in select id,order_id,reserved_amount from public.pending_orders
      where account_id=p_account_id and side='BUY' order by created_at desc,id desc loop
    exit when v_reserved<=greatest(p_cash_after,0);
    perform public.cancel_pending_spot_order(p_account_id,v_pending.id);
    v_reserved:=v_reserved-v_pending.reserved_amount;
    v_cancelled:=v_cancelled||jsonb_build_array(jsonb_build_object('pending_order_id',v_pending.id,
      'order_id',v_pending.order_id,'released_amount',v_pending.reserved_amount));
  end loop;
  return v_cancelled;
end; $$;

create or replace function public.close_futures_position(p_account_id bigint,p_position_id uuid,p_current_price numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account public.accounts%rowtype;v_position public.futures_positions%rowtype;
  v_pnl numeric(30,2);v_payout numeric(30,2);v_direction integer;v_released jsonb;
begin
  if p_current_price is null or p_current_price::text in ('NaN','Infinity','-Infinity') or p_current_price<=0 then
    raise exception using errcode='22023',message='현재가가 올바르지 않습니다.';
  end if;
  select * into v_account from public.accounts where id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.'; end if;
  select * into v_position from public.futures_positions where id=p_position_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='선물 포지션을 찾을 수 없습니다.'; end if;
  v_direction:=case when v_position.side='LONG' then 1 else -1 end;
  v_pnl:=round((p_current_price-v_position.entry_price)*v_position.multiplier*v_position.quantity*v_direction,2);
  v_payout:=v_position.margin+v_pnl;
  if v_account.krw_balance+v_payout<0 then
    raise exception using errcode='P0001',message='청산 손실을 감당할 예수금이 부족합니다.';
  end if;
  v_released:=public.release_reserved_cash_for_futures(p_account_id,v_account.krw_balance+v_payout);
  update public.accounts set krw_balance=krw_balance+v_payout,updated_at=now() where id=p_account_id returning * into v_account;
  delete from public.futures_positions where id=v_position.id;
  insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type,reference_id,metadata)
  values(p_account_id,'FUTURES_CLOSE',v_payout,v_account.krw_balance,'futures_position',v_position.id::text,
    jsonb_build_object('pnl',v_pnl,'current_price',p_current_price,'cancelled_pending_orders',v_released));
  return jsonb_build_object('account',to_jsonb(v_account),'position',to_jsonb(v_position),'pnl',v_pnl,'payout',v_payout,
    'current_price',p_current_price,'cancelled_pending_orders',v_released);
end; $$;

create or replace function public.force_liquidate_futures_position(p_account_id bigint,p_position_id uuid,p_current_price numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account public.accounts%rowtype;v_position public.futures_positions%rowtype;v_contract public.finance_contracts%rowtype;
  v_pnl numeric(30,2);v_payout numeric(30,2);v_delta numeric(30,2);v_deficit numeric(30,2);v_direction integer;v_released jsonb;
begin
  if p_current_price is null or p_current_price::text in ('NaN','Infinity','-Infinity') or p_current_price<=0 then
    raise exception using errcode='22023',message='현재가가 올바르지 않습니다.';
  end if;
  select * into v_account from public.accounts where id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.'; end if;
  select * into v_position from public.futures_positions where id=p_position_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='선물 포지션을 찾을 수 없습니다.'; end if;
  v_direction:=case when v_position.side='LONG' then 1 else -1 end;
  v_pnl:=round((p_current_price-v_position.entry_price)*v_position.multiplier*v_position.quantity*v_direction,2);
  v_payout:=v_position.margin+v_pnl;
  v_delta:=greatest(-v_account.krw_balance,v_payout);
  v_deficit:=greatest(0,-(v_account.krw_balance+v_payout));
  v_released:=public.release_reserved_cash_for_futures(p_account_id,v_account.krw_balance+v_delta);
  update public.accounts set krw_balance=krw_balance+v_delta,updated_at=now() where id=p_account_id returning * into v_account;
  delete from public.futures_positions where id=v_position.id;
  insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type,reference_id,metadata)
  values(p_account_id,'FORCED_LIQUIDATION',v_delta,v_account.krw_balance,'futures_position',v_position.id::text,
    jsonb_build_object('pnl',v_pnl,'payout',v_payout,'deficit',v_deficit,'current_price',p_current_price,
      'cancelled_pending_orders',v_released));
  if v_deficit>0 then
    -- 현금은 0원에서 멈추고, 넘는 손실은 미수 부채로 남겨 위험평가 의무와 금융 상환 대상에 포함한다.
    insert into public.finance_contracts as c (account_id,product_type,active,limit_amount,debt,locked_amount)
    values(p_account_id,'margin',true,v_deficit,v_deficit,0)
    on conflict(account_id,product_type) do update set active=true,debt=c.debt+excluded.debt,
      limit_amount=greatest(c.limit_amount,c.debt+excluded.debt),updated_at=now()
    returning * into v_contract;
    insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type,reference_id,metadata)
    values(p_account_id,'FUTURES_DEFICIT_RECEIVABLE',0,v_account.krw_balance,'finance_contract','margin',
      jsonb_build_object('receivable',v_deficit,'debt_after',v_contract.debt,'futures_position_id',v_position.id,'symbol',v_position.symbol));
  end if;
  update public.margin_calls set status='LIQUIDATED',resolved_at=now() where account_id=p_account_id and status='OPEN';
  return jsonb_build_object('account',to_jsonb(v_account),'position',to_jsonb(v_position),'pnl',v_pnl,'payout',v_payout,
    'deficit',v_deficit,'receivable',case when v_deficit>0 then to_jsonb(v_contract) else null end,
    'cancelled_pending_orders',v_released);
end; $$;

revoke all on function public.release_reserved_cash_for_futures(bigint,numeric) from public,anon,authenticated,service_role;
revoke all on function public.close_futures_position(bigint,uuid,numeric),
  public.force_liquidate_futures_position(bigint,uuid,numeric) from public,anon,authenticated;
grant execute on function public.close_futures_position(bigint,uuid,numeric),
  public.force_liquidate_futures_position(bigint,uuid,numeric) to service_role;
