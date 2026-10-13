-- 동일 서버시세를 여러 worker/탭이 관측해도 부분체결은 한 번만 적용한다.
alter table public.pending_orders add column if not exists last_matched_quote_at timestamptz;
create table if not exists public.order_quote_matches (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  quote_updated_at timestamptz not null,
  execution_price numeric not null,
  filled_quantity numeric not null,
  created_at timestamptz not null default now(),
  unique(order_id,quote_updated_at)
);
alter table public.order_quote_matches enable row level security;
revoke all on table public.order_quote_matches from public,anon,authenticated,service_role;

create or replace function public.match_pending_spot_order(
  p_account_id bigint,p_pending_order_id uuid,p_execution_price numeric,p_fill_quantity numeric,
  p_observed_quantity numeric,p_observed_limit_price numeric,p_quote_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_pending public.pending_orders%rowtype;v_result jsonb;
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
  if (v_pending.side='BUY' and p_execution_price>v_pending.limit_price)
    or (v_pending.side='SELL' and p_execution_price<v_pending.limit_price) then
    return jsonb_build_object('matched',false,'reason','not_crossed');
  end if;
  v_result:=public.place_pending_spot_order(p_account_id,p_pending_order_id,p_execution_price,p_fill_quantity);
  update public.pending_orders set last_matched_quote_at=p_quote_updated_at where id=p_pending_order_id;
  insert into public.order_quote_matches(order_id,quote_updated_at,execution_price,filled_quantity)
    values(v_pending.order_id,p_quote_updated_at,p_execution_price,p_fill_quantity);
  return v_result||jsonb_build_object('matched',true);
end; $$;
revoke all on function public.match_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric,timestamptz)
  from public,anon,authenticated;
grant execute on function public.match_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric,timestamptz)
  to service_role;
