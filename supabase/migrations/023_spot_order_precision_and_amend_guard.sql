-- 현물 주문 정확성 보완.
-- 1) 체결가를 가격 컬럼(numeric(30,8))과 같은 8자리로 맞춘 뒤 저장된 지정가와 비교한다.
--    345.60달러*1380=476928.00000000006처럼 미반올림 체결가가 들어오면 교차한 매수도 not_crossed가 되었다.
-- 2) 정정 시 화면이 본 잔량을 잠금 후 비교한다. 정정 창을 연 사이 부분체결되면
--    016의 quantity=filled_quantity+p_quantity 갱신으로 총주문수량이 늘어나던 경합을 409(P4090)로 거부한다.
-- 3) 합성 원화 ETF SH10X는 6자리 코드가 아니어서 해외주식(0.07%) 요율이 적용되었다. 화면과 같은 국내 ETF 요율로 고정한다.

insert into public.trade_charge_overrides(symbol,policy_code) values ('SH10X','KR_ETF')
on conflict(symbol) do update set policy_code=excluded.policy_code;

create or replace function public.match_pending_spot_order(
  p_account_id bigint,p_pending_order_id uuid,p_execution_price numeric,p_fill_quantity numeric,
  p_observed_quantity numeric,p_observed_limit_price numeric,p_quote_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype;v_result jsonb;v_price numeric:=round(p_execution_price,8);
begin
  perform 1 from public.accounts where id=p_account_id for update;
  select * into v_pending from public.pending_orders where account_id=p_account_id and id=p_pending_order_id for update;
  if not found then return jsonb_build_object('matched',false,'reason','removed'); end if;
  if v_pending.quantity is distinct from p_observed_quantity or v_pending.limit_price is distinct from p_observed_limit_price then
    return jsonb_build_object('matched',false,'reason','changed');
  end if;
  if p_quote_updated_at is null or p_quote_updated_at>now()+interval '1 minute'
    or p_quote_updated_at<now()-(case when v_pending.category='bonds' then interval '7 days' else interval '2 minutes' end)
    or p_quote_updated_at<=v_pending.last_matched_quote_at then
    return jsonb_build_object('matched',false,'reason','stale_quote');
  end if;
  if (v_pending.side='BUY' and v_price>v_pending.limit_price)
    or (v_pending.side='SELL' and v_price<v_pending.limit_price) then
    return jsonb_build_object('matched',false,'reason','not_crossed');
  end if;
  v_result:=public.place_pending_spot_order(p_account_id,p_pending_order_id,v_price,p_fill_quantity);
  update public.pending_orders set last_matched_quote_at=p_quote_updated_at where id=p_pending_order_id;
  insert into public.order_quote_matches(order_id,quote_updated_at,execution_price,filled_quantity)
    values(v_pending.order_id,p_quote_updated_at,v_price,p_fill_quantity);
  return v_result||jsonb_build_object('matched',true);
end; $$;

-- 브라우저/API의 직접 체결 요청도 같은 8자리 체결가로 지정가 조건과 예약금을 평가한다.
create or replace function public.place_pending_spot_order(p_account_id bigint,p_pending_order_id uuid,
  p_execution_price numeric,p_fill_quantity numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype;v_fill numeric;v_result jsonb;v_previous text;
  v_price numeric:=round(p_execution_price,8);
begin
  perform 1 from public.accounts where id=p_account_id for update;
  select * into v_pending from public.pending_orders where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.'; end if;
  v_fill:=coalesce(p_fill_quantity,v_pending.quantity);
  if v_fill>v_pending.quantity then raise exception using errcode='22023',message='부분체결 수량이 잔여수량을 초과했습니다.'; end if;
  perform public.assert_spot_order_capacity(p_account_id,v_pending.symbol,v_pending.category,v_pending.side,v_fill,v_price,
    p_pending_order_id,v_pending.quantity-v_fill,v_pending.limit_price);
  v_previous:=coalesce(current_setting('app.executing_pending_order',true),'');
  perform set_config('app.executing_pending_order',p_pending_order_id::text,true);
  v_result:=public.place_pending_spot_order_unreserved_v019(p_account_id,p_pending_order_id,v_price,v_fill);
  perform set_config('app.executing_pending_order',v_previous,true);
  return v_result;
end; $$;

-- 기존 5인수 정정 RPC는 호환을 위해 유지하고, 서버는 기대 잔량을 함께 보내는 6인수 RPC를 사용한다.
-- 기본값을 두지 않아 5인수 호출이 두 오버로드 사이에서 모호해지지 않는다.
create or replace function public.amend_pending_spot_order(p_account_id bigint,p_pending_order_id uuid,p_quantity numeric,
  p_limit_price numeric,p_reservation_amount numeric,p_expected_remaining numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_remaining numeric;
begin
  if p_expected_remaining is null or p_expected_remaining<=0 or p_expected_remaining::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='22023',message='정정 기준 잔여수량이 올바르지 않습니다.';
  end if;
  -- 체결/취소와 같은 계좌→미체결 순서로 잠근 뒤 비교해야 비교와 정정 사이에 체결이 끼어들지 못한다.
  perform 1 from public.accounts where id=p_account_id for update;
  select quantity into v_remaining from public.pending_orders
    where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.'; end if;
  if v_remaining<>p_expected_remaining then
    raise exception using errcode='P4090',
      message='정정 화면을 연 사이 주문이 체결되어 잔여수량이 바뀌었습니다. 최신 미체결 내역을 확인한 뒤 다시 정정해 주세요.';
  end if;
  return public.amend_pending_spot_order(p_account_id,p_pending_order_id,p_quantity,p_limit_price,p_reservation_amount);
end; $$;

revoke all on function public.match_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric,timestamptz),
  public.place_pending_spot_order(bigint,uuid,numeric,numeric),
  public.amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.match_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric,timestamptz),
  public.place_pending_spot_order(bigint,uuid,numeric,numeric),
  public.amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric)
  to service_role;
