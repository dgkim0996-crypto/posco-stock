create or replace function public.apply_cash_operation(p_account_id bigint,p_operation text,p_amount numeric,p_usd_krw numeric default 1380)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account public.accounts%rowtype;v_krw_delta numeric(30,2):=0;v_usd_delta numeric(30,4):=0;
begin
 if p_operation not in('DEPOSIT_KRW','TRANSFER_KRW','EXCHANGE_TO_USD','EXCHANGE_TO_KRW')then raise exception using errcode='22023',message='지원하지 않는 현금 작업입니다.';end if;
 if p_amount is null or p_amount<=0 or p_usd_krw<=0 then raise exception using errcode='22023',message='금액이 올바르지 않습니다.';end if;
 select * into v_account from public.accounts where id=p_account_id for update;if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.';end if;
 if p_operation='DEPOSIT_KRW' then v_krw_delta:=p_amount;
 elsif p_operation='TRANSFER_KRW' then v_krw_delta:=-p_amount;
 elsif p_operation='EXCHANGE_TO_USD' then v_krw_delta:=-p_amount;v_usd_delta:=round(p_amount/p_usd_krw,4);
 else v_usd_delta:=-p_amount;v_krw_delta:=round(p_amount*p_usd_krw,2);end if;
 if v_account.krw_balance+v_krw_delta<0 then raise exception using errcode='P0001',message='원화 예수금이 부족합니다.';end if;
 if v_account.usd_balance+v_usd_delta<0 then raise exception using errcode='P0001',message='외화 예수금이 부족합니다.';end if;
 update public.accounts set krw_balance=krw_balance+v_krw_delta,usd_balance=usd_balance+v_usd_delta,updated_at=now()where id=p_account_id returning * into v_account;
 insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type)values(p_account_id,p_operation,v_krw_delta,v_account.krw_balance,'cash_operation');
 return jsonb_build_object('account',to_jsonb(v_account),'krw_delta',v_krw_delta,'usd_delta',v_usd_delta);
end;$$;

create or replace function public.reset_demo_account(p_account_id bigint,p_starting_cash numeric default 10000000)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_account public.accounts%rowtype;
begin
 perform 1 from public.accounts where id=p_account_id for update;if not found then raise exception using errcode='P0002',message='계좌를 찾을 수 없습니다.';end if;
 delete from public.orders where account_id=p_account_id;delete from public.holdings where account_id=p_account_id;delete from public.short_positions where account_id=p_account_id;delete from public.futures_positions where account_id=p_account_id;delete from public.finance_contracts where account_id=p_account_id;delete from public.cash_ledger where account_id=p_account_id;
 update public.accounts set krw_balance=p_starting_cash,usd_balance=0,updated_at=now()where id=p_account_id returning * into v_account;
 insert into public.cash_ledger(account_id,event_type,amount,balance_after,reference_type)values(p_account_id,'ACCOUNT_RESET',p_starting_cash,p_starting_cash,'account');
 return to_jsonb(v_account);
end;$$;
revoke all on function public.apply_cash_operation(bigint,text,numeric,numeric)from public,anon,authenticated;
revoke all on function public.reset_demo_account(bigint,numeric)from public,anon,authenticated;
grant execute on function public.apply_cash_operation(bigint,text,numeric,numeric)to service_role;
grant execute on function public.reset_demo_account(bigint,numeric)to service_role;
