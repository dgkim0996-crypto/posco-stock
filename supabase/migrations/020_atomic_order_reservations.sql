-- 주문가능금액/매도가능수량을 계좌 행 잠금으로 보호한다.
-- 체결·원장 구현은 기존 RPC를 재사용하며 외부 호출 권한은 검증 래퍼에만 부여한다.
create or replace function public.validate_spot_quantity(p_category text,p_quantity numeric)
returns void language plpgsql immutable set search_path=public as $$
begin
  if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or p_quantity<=0
    or p_quantity>9007199254740991 or round(p_quantity,8)<>p_quantity
    or (p_category<>'crypto' and trunc(p_quantity)<>p_quantity) then
    raise exception using errcode='22023',message='주문수량이 올바르지 않습니다. 주식과 채권 수량은 정수여야 합니다.';
  end if;
end; $$;

create or replace function public.spot_buy_reservation(p_symbol text,p_category text,p_quantity numeric,p_price numeric)
returns numeric language plpgsql stable set search_path=public as $$
declare v_policy text;v_fee numeric;v_gross numeric;
begin
  if p_quantity=0 then return 0; end if;
  select policy_code into v_policy from public.trade_charge_overrides where symbol=p_symbol;
  v_policy:=coalesce(v_policy,case when p_category<>'stocks' then 'OTHER'
    when p_symbol~'^[0-9]{6}$' then 'KR_STOCK' else 'US_STOCK' end);
  select fee_rate into v_fee from public.trade_charge_policies where code=v_policy;
  if v_fee is null then raise exception using errcode='P0001',message='주문 수수료 정책이 없습니다.'; end if;
  v_gross:=round(p_quantity*p_price,2);
  return v_gross+round(v_gross*v_fee,2);
end; $$;

create or replace function public.assert_spot_order_capacity(p_account_id bigint,p_symbol text,p_category text,p_side text,
  p_quantity numeric,p_price numeric,p_exclude_pending uuid default null,p_remaining numeric default 0,p_remaining_price numeric default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_cash numeric;v_reserved numeric;v_required numeric;v_borrowed numeric;v_used numeric;
  v_lending public.finance_contracts%rowtype;
begin
  perform public.validate_spot_quantity(p_category,p_quantity);
  if p_side is null or p_side not in ('BUY','SELL') or p_category is null or p_category not in ('stocks','bonds','crypto')
    or p_price is null or p_price<=0 or p_price::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='22023',message='주문 정보가 올바르지 않습니다.';
  end if;
  select krw_balance into v_cash from public.accounts where id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.'; end if;
  if p_side='BUY' then
    select coalesce(sum(reserved_amount),0) into v_reserved from public.pending_orders
      where account_id=p_account_id and side='BUY' and id is distinct from p_exclude_pending;
    v_required:=public.spot_buy_reservation(p_symbol,p_category,p_quantity,p_price)
      +public.spot_buy_reservation(p_symbol,p_category,p_remaining,coalesce(p_remaining_price,p_price));
    if v_reserved+v_required>v_cash then
      raise exception using errcode='P0001',message='수수료와 미체결 예약금을 포함한 주문가능금액이 부족합니다.';
    end if;
  else
    -- 모든 미체결 매도와 새 주문을 함께 평가하여 보유주식 및 대주한도를 중복 사용하지 않는다.
    with sell_orders as (
      select symbol,category,quantity,limit_price as price from public.pending_orders
        where account_id=p_account_id and side='SELL' and id is distinct from p_exclude_pending
      union all select p_symbol,p_category,p_quantity+p_remaining,greatest(p_price,coalesce(p_remaining_price,p_price))
    ), exposures as (
      select s.symbol,s.category,greatest(sum(s.quantity)-coalesce(h.quantity,0),0) as borrowed,max(s.price) as price
      from sell_orders s left join public.holdings h on h.account_id=p_account_id and h.symbol=s.symbol
      group by s.symbol,s.category,h.quantity
    ) select coalesce(sum(borrowed*price),0),coalesce(sum(case when category<>'stocks' then borrowed else 0 end),0)
      into v_borrowed,v_required from exposures;
    if v_required>0 then raise exception using errcode='P0001',message='미체결 매도수량을 제외한 매도가능수량이 부족합니다.'; end if;
    if v_borrowed>0 then
      select * into v_lending from public.finance_contracts where account_id=p_account_id and product_type='lending';
      if v_lending.account_id is null or not v_lending.active then
        raise exception using errcode='P0001',message='미체결 매도수량을 제외한 매도가능수량이 부족합니다.';
      end if;
      select coalesce(sum(quantity*avg_price),0) into v_used from public.short_positions where account_id=p_account_id;
      if v_used+v_borrowed>v_lending.limit_amount then
        raise exception using errcode='P0001',message='미체결 매도수량을 포함한 대주한도를 초과했습니다.';
      end if;
    end if;
  end if;
end; $$;

-- 초기/부분체결/정정 모두 DB 정책으로 예약금을 다시 계산한다.
create or replace function public.normalize_pending_reservation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.validate_spot_quantity(new.category,new.quantity);
  if new.limit_price<=0 or new.limit_price::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='22023',message='지정가가 올바르지 않습니다.';
  end if;
  new.reserved_amount:=case when new.side='BUY'
    then public.spot_buy_reservation(new.symbol,new.category,new.quantity,new.limit_price) else 0 end;
  return new;
end; $$;
drop trigger if exists pending_orders_reservation on public.pending_orders;
create trigger pending_orders_reservation before insert or update on public.pending_orders
  for each row execute function public.normalize_pending_reservation();
update public.pending_orders set reserved_amount=case when side='BUY'
  then public.spot_buy_reservation(symbol,category,quantity,limit_price) else 0 end;

-- 출금·환전·선물 증거금·신용상환도 매수 예약금을 소비할 수 없게 한다.
create or replace function public.protect_reserved_cash()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_reserved numeric;v_exclude uuid;
begin
  if new.krw_balance>=old.krw_balance then return new; end if;
  v_exclude:=nullif(current_setting('app.executing_pending_order',true),'')::uuid;
  select coalesce(sum(reserved_amount),0) into v_reserved from public.pending_orders
    where account_id=new.id and side='BUY' and id is distinct from v_exclude;
  if new.krw_balance<v_reserved then
    raise exception using errcode='P0001',message='미체결 매수 예약금을 사용할 수 없습니다. 주문을 취소하거나 금액을 줄여 주세요.';
  end if;
  return new;
end; $$;
drop trigger if exists accounts_protect_reserved_cash on public.accounts;
create trigger accounts_protect_reserved_cash before update of krw_balance on public.accounts
  for each row execute function public.protect_reserved_cash();

do $$ begin
  if to_regprocedure('public.place_spot_order_unreserved_v019(bigint,text,text,text,text,numeric,numeric,numeric)') is null then
    alter function public.place_spot_order(bigint,text,text,text,text,numeric,numeric,numeric) rename to place_spot_order_unreserved_v019;
    alter function public.create_pending_spot_order(bigint,text,text,text,numeric,numeric,numeric) rename to create_pending_spot_order_unreserved_v019;
    alter function public.amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric) rename to amend_pending_spot_order_unreserved_v019;
    alter function public.place_pending_spot_order(bigint,uuid,numeric,numeric) rename to place_pending_spot_order_unreserved_v019;
    alter function public.cancel_pending_spot_order(bigint,uuid) rename to cancel_pending_spot_order_unreserved_v019;
  end if;
end; $$;

create or replace function public.place_spot_order(p_account_id bigint,p_symbol text,p_category text,p_side text,
  p_order_type text,p_quantity numeric,p_requested_price numeric,p_execution_price numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_order_type='LIMIT' and (p_requested_price is null or p_requested_price<=0
    or (p_side='BUY' and p_execution_price>p_requested_price) or (p_side='SELL' and p_execution_price<p_requested_price)) then
    raise exception using errcode='P0001',message='지정가 체결 조건에 도달하지 않았습니다.';
  end if;
  perform public.assert_spot_order_capacity(p_account_id,p_symbol,p_category,p_side,p_quantity,p_execution_price);
  return public.place_spot_order_unreserved_v019(p_account_id,p_symbol,p_category,p_side,p_order_type,p_quantity,p_requested_price,p_execution_price);
end; $$;

create or replace function public.create_pending_spot_order(p_account_id bigint,p_symbol text,p_category text,p_side text,
  p_quantity numeric,p_limit_price numeric,p_reservation_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_spot_order_capacity(p_account_id,p_symbol,p_category,p_side,p_quantity,p_limit_price);
  return public.create_pending_spot_order_unreserved_v019(p_account_id,p_symbol,p_category,p_side,p_quantity,p_limit_price,
    public.spot_buy_reservation(p_symbol,p_category,p_quantity,p_limit_price));
end; $$;

create or replace function public.amend_pending_spot_order(p_account_id bigint,p_pending_order_id uuid,p_quantity numeric,
  p_limit_price numeric,p_reservation_amount numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype;v_result jsonb;
begin
  perform 1 from public.accounts where id=p_account_id for update;
  select * into v_pending from public.pending_orders where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.'; end if;
  perform public.assert_spot_order_capacity(p_account_id,v_pending.symbol,v_pending.category,v_pending.side,p_quantity,p_limit_price,p_pending_order_id);
  v_result:=public.amend_pending_spot_order_unreserved_v019(p_account_id,p_pending_order_id,p_quantity,p_limit_price,
    public.spot_buy_reservation(v_pending.symbol,v_pending.category,p_quantity,p_limit_price));
  -- 수량이 그대로인 가격 정정도 감사 이벤트를 반드시 남긴다.
  if p_quantity=v_pending.quantity and v_pending.order_id is not null then
    insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,metadata)
    select p_account_id,id,'AMENDED',filled_quantity,remaining_quantity,
      jsonb_build_object('previous_price',v_pending.limit_price,'requested_price',p_limit_price)
      from public.orders where id=v_pending.order_id;
  end if;
  return v_result;
end; $$;

create or replace function public.place_pending_spot_order(p_account_id bigint,p_pending_order_id uuid,
  p_execution_price numeric,p_fill_quantity numeric default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype;v_fill numeric;v_result jsonb;v_previous text;
begin
  perform 1 from public.accounts where id=p_account_id for update;
  select * into v_pending from public.pending_orders where id=p_pending_order_id and account_id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='미체결 주문을 찾을 수 없습니다.'; end if;
  v_fill:=coalesce(p_fill_quantity,v_pending.quantity);
  if v_fill>v_pending.quantity then raise exception using errcode='22023',message='부분체결 수량이 잔여수량을 초과했습니다.'; end if;
  perform public.assert_spot_order_capacity(p_account_id,v_pending.symbol,v_pending.category,v_pending.side,v_fill,p_execution_price,
    p_pending_order_id,v_pending.quantity-v_fill,v_pending.limit_price);
  v_previous:=coalesce(current_setting('app.executing_pending_order',true),'');
  perform set_config('app.executing_pending_order',p_pending_order_id::text,true);
  v_result:=public.place_pending_spot_order_unreserved_v019(p_account_id,p_pending_order_id,p_execution_price,v_fill);
  perform set_config('app.executing_pending_order',v_previous,true);
  return v_result;
end; $$;

create or replace function public.cancel_pending_spot_order(p_account_id bigint,p_pending_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  -- 계좌→미체결 순서로 잠가 체결/정정/취소 사이 교착을 방지한다.
  perform 1 from public.accounts where id=p_account_id for update;
  return public.cancel_pending_spot_order_unreserved_v019(p_account_id,p_pending_order_id);
end; $$;

-- 012의 3인수 오버로드는 015의 부분체결 구현으로 교체되었지만 DB에 남아 있었다.
-- 기본 p_fill_quantity=null을 제공하는 보호된 4인수 RPC만 남겨 우회/오버로드 모호성을 없앤다.
drop function if exists public.place_pending_spot_order(bigint,uuid,numeric);

revoke all on function public.place_spot_order_unreserved_v019(bigint,text,text,text,text,numeric,numeric,numeric),
  public.create_pending_spot_order_unreserved_v019(bigint,text,text,text,numeric,numeric,numeric),
  public.amend_pending_spot_order_unreserved_v019(bigint,uuid,numeric,numeric,numeric),
  public.place_pending_spot_order_unreserved_v019(bigint,uuid,numeric,numeric),
  public.cancel_pending_spot_order_unreserved_v019(bigint,uuid),
  public.assert_spot_order_capacity(bigint,text,text,text,numeric,numeric,uuid,numeric,numeric),
  public.spot_buy_reservation(text,text,numeric,numeric),public.validate_spot_quantity(text,numeric),
  public.normalize_pending_reservation(),public.protect_reserved_cash()
  from public,anon,authenticated,service_role;
revoke all on function public.place_spot_order(bigint,text,text,text,text,numeric,numeric,numeric),
  public.create_pending_spot_order(bigint,text,text,text,numeric,numeric,numeric),
  public.amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric),
  public.place_pending_spot_order(bigint,uuid,numeric,numeric),public.cancel_pending_spot_order(bigint,uuid)
  from public,anon,authenticated;
grant execute on function public.place_spot_order(bigint,text,text,text,text,numeric,numeric,numeric),
  public.create_pending_spot_order(bigint,text,text,text,numeric,numeric,numeric),
  public.amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric),
  public.place_pending_spot_order(bigint,uuid,numeric,numeric),public.cancel_pending_spot_order(bigint,uuid)
  to service_role;
