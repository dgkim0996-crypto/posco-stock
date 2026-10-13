import"dotenv/config";import pg from"pg";
const assert=(condition,message)=>{if(!condition)throw new Error(`검증 실패: ${message}`);};
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
try{await client.connect();await client.query("begin");
 const accountId=(await client.query("insert into public.accounts(account_number,krw_balance,usd_balance)values($1,15000,0)returning id",[`E2E-RISK-${Date.now()}`])).rows[0].id;
 const opened=(await client.query("select public.open_futures_position($1,'K200','LONG',1,100,1000,0.1) result",[accountId])).rows[0].result;
 assert(Number(opened.position.margin)===10000,"최초증거금 불일치");
 await client.query("select public.record_risk_snapshot($1,'MARGIN_CALL',7000,7500,0.933333,500,$2::jsonb)",[accountId,JSON.stringify({source:"e2e"})]);
 const call=(await client.query("select * from public.margin_calls where account_id=$1 and status='OPEN' order by created_at desc limit 1",[accountId])).rows[0];
 assert(call.status==="OPEN"&&Number(call.required_amount)===500,"마진콜 생성 불일치");
 const liquidated=(await client.query("select public.force_liquidate_futures_position($1,$2,80) result",[accountId,opened.position.id])).rows[0].result;
 assert(Number(liquidated.pnl)===-20000&&Number(liquidated.payout)===-10000,"강제청산 손익 불일치");
 assert(Number(liquidated.deficit)===5000&&Number(liquidated.account.krw_balance)===0,"미충당액 또는 잔액 불일치");
 const positionCount=Number((await client.query("select count(*) count from public.futures_positions where account_id=$1",[accountId])).rows[0].count);
 const event=(await client.query("select * from public.cash_ledger where account_id=$1 and event_type='FORCED_LIQUIDATION'",[accountId])).rows[0];
 const finalCall=(await client.query("select status from public.margin_calls where id=$1",[call.id])).rows[0];
 assert(positionCount===0,"강제청산 후 포지션 잔존");assert(Number(event.amount)===-5000,"강제청산 원장 금액 불일치");assert(finalCall.status==="LIQUIDATED","마진콜 종료상태 불일치");
 const ledgerCount=Number((await client.query("select count(*) count from public.account_ledger where account_id=$1 and event_type='FORCED_LIQUIDATION'",[accountId])).rows[0].count);assert(ledgerCount===1,"통합 감사 원장 누락");
 // 증거금+예수금을 넘는 손실 5,000원은 탕감하지 않고 미수(margin) 부채로 남는다.
 const receivable=(await client.query("select * from public.finance_contracts where account_id=$1 and product_type='margin'",[accountId])).rows[0];
 assert(receivable?.active===true&&Number(receivable.debt)===5000&&Number(liquidated.receivable.debt)===5000,"강제청산 부족분 미수 부채 미기록");
 const receivableEvent=(await client.query("select * from public.account_ledger where account_id=$1 and event_type='FUTURES_DEFICIT_RECEIVABLE'",[accountId])).rows[0];
 assert(Number(receivableEvent?.amount)===0&&Number(receivableEvent.metadata.receivable)===5000,"미수 발생 감사 원장 누락");

 const newAccount=async(cash,label)=>(await client.query("insert into public.accounts(account_number,krw_balance,usd_balance)values($1,$2,0)returning id",[`E2E-RISK-${label}-${Date.now()}`,cash])).rows[0].id;
 const rows=async(sql,params)=>(await client.query(sql,params)).rows;
 const buyPending=async(id,quantity)=>(await client.query("select public.create_pending_spot_order($1,'005490','stocks','BUY',$2,1000,1) result",[id,quantity])).rows[0].result;

 // 환율: NQ 달러 승수 20을 모의환율 1,380원으로 환산한 원화 승수 27,600으로 증거금·손익을 원화 정산한다.
 const fxAccount=await newAccount(60000000,"FX");
 const fxOpened=(await client.query("select public.open_futures_position($1,'NQ','LONG',1,20000,$2,0.1) result",[fxAccount,20*1380])).rows[0].result;
 assert(Number(fxOpened.position.margin)===55200000&&Number(fxOpened.account.krw_balance)===4800000,"달러 선물 원화 증거금 불일치");
 const fxClosed=(await client.query("select public.close_futures_position($1,$2,20010) result",[fxAccount,fxOpened.position.id])).rows[0].result;
 assert(Number(fxClosed.pnl)===276000&&Number(fxClosed.account.krw_balance)===60276000,"달러 선물 원화 손익 불일치");

 // 예약금: 손실 청산 후 현금이 미체결 매수 예약금보다 작아지면 최근 매수부터 필요한 만큼만 취소하고 청산한다.
 const closeAccount=await newAccount(30000,"RESERVED-CLOSE");
 const olderBuy=await buyPending(closeAccount,5);const newerBuy=await buyPending(closeAccount,10);
 await client.query("update public.pending_orders set created_at=created_at-interval '1 minute' where id=$1",[olderBuy.pending_order.id]);
 const reservedPosition=(await client.query("select public.open_futures_position($1,'K200','LONG',1,100,1000,0.1) result",[closeAccount])).rows[0].result;
 const reservedClose=(await client.query("select public.close_futures_position($1,$2,85) result",[closeAccount,reservedPosition.position.id])).rows[0].result;
 assert(Number(reservedClose.payout)===-5000&&Number(reservedClose.account.krw_balance)===15000,"예약금 보유 계좌 손실 청산 실패");
 assert(reservedClose.cancelled_pending_orders.length===1&&reservedClose.cancelled_pending_orders[0].pending_order_id===newerBuy.pending_order.id,"최근 미체결 매수만 취소해야 함");
 const remainingPending=await rows("select id,reserved_amount from public.pending_orders where account_id=$1",[closeAccount]);
 assert(remainingPending.length===1&&remainingPending[0].id===olderBuy.pending_order.id,"필요 이상 미체결 매수 취소");
 const cancelledOrder=(await rows("select status from public.orders where id=$1",[newerBuy.order.id]))[0];
 const cancelEvents=await rows("select event_type from public.order_events where order_id=$1 and event_type='CANCELLED'",[newerBuy.order.id]);
 assert(cancelledOrder.status==="CANCELLED"&&cancelEvents.length===1,"청산 사유 주문취소 이벤트 누락");
 const closeLedger=(await rows("select metadata from public.cash_ledger where account_id=$1 and event_type='FUTURES_CLOSE'",[closeAccount]))[0];
 assert(closeLedger.metadata.cancelled_pending_orders.length===1,"청산 원장에 취소 주문 기록 누락");

 // 강제청산: 미체결 매수를 모두 풀어 현금을 0원까지 쓰고, 넘는 손실은 기존 미수 부채에 더한 뒤 상환할 수 있어야 한다.
 const forcedAccount=await newAccount(16000,"RESERVED-FORCED");
 const forcedBuy=await buyPending(forcedAccount,5);
 await client.query("insert into public.finance_contracts(account_id,product_type,active,limit_amount,debt)values($1,'margin',true,100000,100000)",[forcedAccount]);
 const forcedPosition=(await client.query("select public.open_futures_position($1,'K200','LONG',1,100,1000,0.1) result",[forcedAccount])).rows[0].result;
 const forced=(await client.query("select public.force_liquidate_futures_position($1,$2,80) result",[forcedAccount,forcedPosition.position.id])).rows[0].result;
 assert(Number(forced.deficit)===4000&&Number(forced.account.krw_balance)===0&&forced.cancelled_pending_orders.length===1,"예약금 보유 계좌 강제청산 실패");
 assert((await rows("select id from public.pending_orders where account_id=$1",[forcedAccount])).length===0,"강제청산 후 미체결 매수 잔존");
 assert((await rows("select status from public.orders where id=$1",[forcedBuy.order.id]))[0].status==="CANCELLED","강제청산 주문취소 상태 불일치");
 const forcedLedger=(await rows("select amount,metadata from public.cash_ledger where account_id=$1 and event_type='FORCED_LIQUIDATION'",[forcedAccount]))[0];
 assert(Number(forcedLedger.amount)===-6000&&Number(forcedLedger.metadata.deficit)===4000,"강제청산 원장 불일치");
 const accumulated=(await rows("select * from public.finance_contracts where account_id=$1 and product_type='margin'",[forcedAccount]))[0];
 assert(Number(accumulated.debt)===104000&&Number(accumulated.limit_amount)===104000,"기존 미수 부채 누적 불일치");
 await client.query("update public.accounts set krw_balance=200000 where id=$1",[forcedAccount]);
 const repaid=(await client.query("select public.settle_finance_contract($1,'margin') result",[forcedAccount])).rows[0].result;
 assert(Number(repaid.account.krw_balance)===96000&&repaid.contract.active===false,"미수 부채 상환 실패");

 // 비정상 시세로는 청산할 수 없다.
 const nanAccount=await newAccount(20000,"NAN");
 const nanPosition=(await client.query("select public.open_futures_position($1,'K200','SHORT',1,100,1000,0.1) result",[nanAccount])).rows[0].result;
 await client.query("savepoint nan_price");
 let nanRejected=false;try{await client.query("select public.force_liquidate_futures_position($1,$2,'NaN'::numeric)",[nanAccount,nanPosition.position.id]);}catch(error){nanRejected=/현재가/.test(error.message);}
 await client.query("rollback to savepoint nan_price");assert(nanRejected,"NaN 현재가 강제청산 허용");
 console.log(JSON.stringify({result:"PASS",initialMargin:10000,marginCallRequired:500,pnl:-20000,payout:-10000,deficit:5000,finalBalance:0,positionClosed:true,marginCallStatus:"LIQUIDATED",accountLedgerRecorded:true,receivableDebt:5000,usdFuturesMarginKrw:55200000,usdFuturesPnlKrw:276000,reservedCloseCancelled:1,forcedReceivableDebt:104000,rolledBack:true},null,2));await client.query("rollback");
}catch(error){await client.query("rollback").catch(()=>undefined);throw error;}finally{await client.end().catch(()=>undefined);}
