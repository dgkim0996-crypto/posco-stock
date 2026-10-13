-- 체결/접수와 재시도 결과를 같은 트랜잭션에 보관한다.
-- 동일 계좌의 동일 clientOrderId는 가격 변동·응답 유실에도 한 번만 실행된다.
create table if not exists public.order_requests (
  account_id bigint not null references public.accounts(id) on delete cascade,
  client_order_id uuid not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (account_id,client_order_id)
);
alter table public.order_requests enable row level security;
revoke all on table public.order_requests from public,anon,authenticated,service_role;

-- 서버의 사전 조회는 최적화일 뿐이다. 아래 쓰기 RPC가 계좌 행 잠금 후 다시 확인한다.
create or replace function public.get_order_request(p_account_id bigint,p_client_order_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request public.order_requests%rowtype;
begin
  if p_client_order_id is null or p_request is null then
    raise exception using errcode='22023',message='clientOrderId와 주문 조건이 필요합니다.';
  end if;
  select * into v_request from public.order_requests
    where account_id=p_account_id and client_order_id=p_client_order_id;
  if not found then return null; end if;
  if v_request.request is distinct from p_request then
    raise exception using errcode='P4090',message='같은 clientOrderId로 주문 내용을 변경할 수 없습니다. 새 주문을 확인해 주세요.';
  end if;
  return v_request.response;
end; $$;

create or replace function public.place_spot_order_once(p_account_id bigint,p_symbol text,p_category text,p_side text,
  p_order_type text,p_quantity numeric,p_requested_price numeric,p_execution_price numeric,p_client_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request jsonb;v_result jsonb;
begin
  v_request:=jsonb_build_object('kind','SPOT','symbol',p_symbol,'category',p_category,'side',p_side,
    'quantity',p_quantity,'orderType',p_order_type,'price',p_requested_price);
  perform 1 from public.accounts where id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.'; end if;
  v_result:=public.get_order_request(p_account_id,p_client_order_id,v_request);
  if v_result is not null then return v_result; end if;
  v_result:=public.place_spot_order(p_account_id,p_symbol,p_category,p_side,p_order_type,p_quantity,p_requested_price,p_execution_price);
  -- 기존 RPC의 지역변수는 AFTER 트리거가 부과한 수수료를 포함하지 않을 수 있다.
  -- 동일 트랜잭션 안에서 최종 행을 읽고, 이 최종 결과까지 원자적으로 저장한다.
  v_result:=v_result||jsonb_build_object(
    'account',(select to_jsonb(a) from public.accounts a where a.id=p_account_id),
    'order',(select to_jsonb(o) from public.orders o where o.id=(v_result->'order'->>'id')::uuid));
  insert into public.order_requests(account_id,client_order_id,request,response)
    values(p_account_id,p_client_order_id,v_request,v_result);
  return v_result;
end; $$;

create or replace function public.create_pending_spot_order_once(p_account_id bigint,p_symbol text,p_category text,p_side text,
  p_quantity numeric,p_limit_price numeric,p_reservation_amount numeric,p_client_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_request jsonb;v_result jsonb;
begin
  v_request:=jsonb_build_object('kind','PENDING','symbol',p_symbol,'category',p_category,'side',p_side,
    'quantity',p_quantity,'orderType','LIMIT','price',p_limit_price);
  perform 1 from public.accounts where id=p_account_id for update;
  if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.'; end if;
  v_result:=public.get_order_request(p_account_id,p_client_order_id,v_request);
  if v_result is not null then return v_result; end if;
  v_result:=public.create_pending_spot_order(p_account_id,p_symbol,p_category,p_side,p_quantity,p_limit_price,p_reservation_amount);
  insert into public.order_requests(account_id,client_order_id,request,response)
    values(p_account_id,p_client_order_id,v_request,v_result);
  return v_result;
end; $$;

revoke all on function public.get_order_request(bigint,uuid,jsonb),
  public.place_spot_order_once(bigint,text,text,text,text,numeric,numeric,numeric,uuid),
  public.create_pending_spot_order_once(bigint,text,text,text,numeric,numeric,numeric,uuid)
  from public,anon,authenticated;
grant execute on function public.get_order_request(bigint,uuid,jsonb),
  public.place_spot_order_once(bigint,text,text,text,text,numeric,numeric,numeric,uuid),
  public.create_pending_spot_order_once(bigint,text,text,text,numeric,numeric,numeric,uuid)
  to service_role;
