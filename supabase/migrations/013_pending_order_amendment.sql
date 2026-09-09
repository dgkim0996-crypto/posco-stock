alter table public.order_events drop constraint if exists order_events_event_type_check;
alter table public.order_events add constraint order_events_event_type_check
  check (event_type in ('ACCEPTED','OPEN','AMENDED','PARTIALLY_FILLED','FILLED','CANCELLED','REJECTED'));

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
    update public.orders set quantity=p_quantity,requested_price=p_limit_price,execution_price=p_limit_price,
      remaining_quantity=p_quantity,updated_at=now() where id=v_pending.order_id and status='OPEN'
      returning * into v_order;
    if not found then raise exception using errcode='P0001',message='정정할 수 없는 주문 상태입니다.'; end if;
    insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,
      execution_price,metadata)
    values(p_account_id,v_order.id,'AMENDED',v_order.filled_quantity,v_order.remaining_quantity,
      p_limit_price,jsonb_build_object('pending_order_id',v_pending.id));
  end if;
  return jsonb_build_object('pending_order',to_jsonb(v_pending),'order',case when v_order.id is null then null else to_jsonb(v_order) end);
end; $$;
revoke all on function public.amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric) to service_role;
