-- 012에서 OPEN/FILLED 이벤트 기록 시 created_at 값 하나가 누락돼 주문 INSERT가 롤백되던 오류를 수정한다.
create or replace function public.record_order_event()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,metadata,created_at)
    values(new.account_id,new.id,'ACCEPTED',0,new.quantity,jsonb_build_object('source','order_insert'),new.created_at);
    if new.status<>'REJECTED' then
      insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,execution_price,metadata,created_at)
      values(new.account_id,new.id,new.status,new.filled_quantity,new.remaining_quantity,
        case when new.status='FILLED' then new.execution_price else null end,
        jsonb_build_object('source','order_insert'),new.created_at);
    end if;
  elsif new.status is distinct from old.status or new.filled_quantity is distinct from old.filled_quantity or new.remaining_quantity is distinct from old.remaining_quantity then
    insert into public.order_events(account_id,order_id,event_type,filled_quantity,remaining_quantity,execution_price,metadata)
    values(new.account_id,new.id,new.status,new.filled_quantity,new.remaining_quantity,
      case when new.filled_quantity>old.filled_quantity then new.execution_price else null end,jsonb_build_object('source','order_update'));
  end if;
  return new;
end; $$;
