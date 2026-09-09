create table if not exists public.futures_positions (
  id uuid primary key default gen_random_uuid(),
  account_id bigint not null references public.accounts(id) on delete cascade,
  symbol text not null,
  side text not null check(side in ('LONG','SHORT')),
  quantity integer not null check(quantity>0),
  entry_price numeric(30,8) not null check(entry_price>0),
  multiplier numeric(30,8) not null check(multiplier>0),
  margin numeric(30,2) not null check(margin>0),
  created_at timestamptz not null default now()
);
create index if not exists futures_positions_account_idx on public.futures_positions(account_id,created_at);
alter table public.futures_positions enable row level security;

create or replace function public.open_futures_position(p_account_id bigint,p_symbol text,p_side text,p_quantity integer,p_entry_price numeric,p_multiplier numeric,p_margin_rate numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account public.accounts%rowtype;v_position public.futures_positions%rowtype;v_margin numeric(30,2);
begin
 if p_side not in('LONG','SHORT')then raise exception using errcode='22023',message='지원하지 않는 포지션 방향입니다.';end if;
 if p_quantity is null or p_quantity<1 or p_entry_price<=0 or p_multiplier<=0 or p_margin_rate<=0 then raise exception using errcode='22023',message='선물 주문값이 올바르지 않습니다.';end if;
 select * into v_account from public.accounts where id=p_account_id for update;if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.';end if;
 v_margin:=round(p_entry_price*p_multiplier*p_margin_rate*p_quantity,2);
 if v_account.krw_balance<v_margin then raise exception using errcode='P0001',message='필요 증거금보다 예수금이 부족합니다.';end if;
 update public.accounts set krw_balance=krw_balance-v_margin,updated_at=now()where id=p_account_id returning * into v_account;
 insert into public.futures_positions(account_id,symbol,side,quantity,entry_price,multiplier,margin)values(p_account_id,p_symbol,p_side,p_quantity,p_entry_price,p_multiplier,v_margin)returning * into v_position;
 insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type,reference_id)values(p_account_id,'FUTURES_OPEN',-v_margin,v_account.krw_balance,'futures_position',v_position.id::text);
 return jsonb_build_object('account',to_jsonb(v_account),'position',to_jsonb(v_position));
end;$$;

create or replace function public.close_futures_position(p_account_id bigint,p_position_id uuid,p_current_price numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account public.accounts%rowtype;v_position public.futures_positions%rowtype;v_pnl numeric(30,2);v_payout numeric(30,2);v_direction integer;
begin
 if p_current_price is null or p_current_price<=0 then raise exception using errcode='22023',message='현재가가 올바르지 않습니다.';end if;
 select * into v_account from public.accounts where id=p_account_id for update;if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.';end if;
 select * into v_position from public.futures_positions where id=p_position_id and account_id=p_account_id for update;if not found then raise exception using errcode='P0002',message='선물 포지션을 찾을 수 없습니다.';end if;
 v_direction:=case when v_position.side='LONG' then 1 else -1 end;
 v_pnl:=round((p_current_price-v_position.entry_price)*v_position.multiplier*v_position.quantity*v_direction,2);v_payout:=v_position.margin+v_pnl;
 if v_account.krw_balance+v_payout<0 then raise exception using errcode='P0001',message='청산 손실을 감당할 예수금이 부족합니다.';end if;
 update public.accounts set krw_balance=krw_balance+v_payout,updated_at=now()where id=p_account_id returning * into v_account;
 delete from public.futures_positions where id=v_position.id;
 insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type,reference_id)values(p_account_id,'FUTURES_CLOSE',v_payout,v_account.krw_balance,'futures_position',v_position.id::text);
 return jsonb_build_object('account',to_jsonb(v_account),'position',to_jsonb(v_position),'pnl',v_pnl,'payout',v_payout,'current_price',p_current_price);
end;$$;
revoke all on function public.open_futures_position(bigint,text,text,integer,numeric,numeric,numeric)from public,anon,authenticated;
revoke all on function public.close_futures_position(bigint,uuid,numeric)from public,anon,authenticated;
grant execute on function public.open_futures_position(bigint,text,text,integer,numeric,numeric,numeric)to service_role;
grant execute on function public.close_futures_position(bigint,uuid,numeric)to service_role;
