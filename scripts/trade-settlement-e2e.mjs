import "dotenv/config";
import pg from "pg";

const assert=(condition,message)=>{if(!condition)throw new Error(`검증 실패: ${message}`);};
const dateIso=(value)=>value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`
  : String(value).slice(0,10);
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
try{
  await client.connect(); await client.query("begin");
  const accountId=(await client.query("insert into public.accounts(account_number,krw_balance,usd_balance) values($1,1000000,0) returning id",[`E2E-SETTLE-${Date.now()}`])).rows[0].id;
  const buy=(await client.query("select public.place_spot_order($1,'005930','stocks','BUY','MARKET',10,null,10000) result",[accountId])).rows[0].result;
  const buyOrder=(await client.query("select * from public.orders where id=$1",[buy.order.id])).rows[0];
  const buyAccount=(await client.query("select krw_balance from public.accounts where id=$1",[accountId])).rows[0];
  assert(Number(buyOrder.fee_amount)===15&&Number(buyOrder.tax_amount)===0,"매수 수수료 또는 세금 불일치");
  assert(Number(buyAccount.krw_balance)===899985,"매수 후 잔액 불일치");

  const sell=(await client.query("select public.place_spot_order($1,'005930','stocks','SELL','MARKET',5,null,11000) result",[accountId])).rows[0].result;
  const sellOrder=(await client.query("select * from public.orders where id=$1",[sell.order.id])).rows[0];
  const sellAccount=(await client.query("select krw_balance from public.accounts where id=$1",[accountId])).rows[0];
  assert(Number(sellOrder.fee_amount)===8.25&&Number(sellOrder.tax_amount)===82.5,"매도 수수료 또는 거래세 불일치");
  assert(Number(sellAccount.krw_balance)===954894.25,"매도 후 잔액 불일치");

  await client.query("select public.place_spot_order($1,'069500','stocks','BUY','MARKET',1,null,10000)",[accountId]);
  const etf=(await client.query("select public.place_spot_order($1,'069500','stocks','SELL','MARKET',1,null,10000) result",[accountId])).rows[0].result;
  const etfOrder=(await client.query("select fee_amount,tax_amount from public.orders where id=$1",[etf.order.id])).rows[0];
  assert(Number(etfOrder.fee_amount)===1.5&&Number(etfOrder.tax_amount)===0,"ETF 면세 정책 불일치");

  const settlements=(await client.query("select * from public.trade_settlements where account_id=$1 order by created_at",[accountId])).rows;
  assert(settlements.length===4,"결제 예정내역 건수 불일치");
  assert(Number(settlements[0].net_amount)===-100015,"매수 순결제금액 불일치");
  assert(Number(settlements[1].net_amount)===54909.25,"매도 순결제금액 불일치");
  for(const item of settlements){
    const expected=(await client.query("select public.add_business_days($1::date,2) value",[item.trade_date])).rows[0].value;
    assert(dateIso(expected)===dateIso(item.settlement_date),`D+2 영업일 계산 불일치: ${dateIso(expected)} / ${dateIso(item.settlement_date)}`);
  }
  const friday=(await client.query("select public.add_business_days('2026-09-11',2) value")).rows[0].value;
  assert(dateIso(friday)==="2026-09-15","주말 제외 D+2 계산 불일치");
  const ledger=(await client.query("select event_type,count(*)::int count from public.cash_ledger where account_id=$1 group by event_type",[accountId])).rows;
  const counts=Object.fromEntries(ledger.map((row)=>[row.event_type,row.count]));
  assert(counts.TRADE_FEE===4&&counts.TRADE_TAX===1,"수수료·세금 원장 건수 불일치");
  const accountLedgerCount=Number((await client.query("select count(*) count from public.account_ledger where account_id=$1",[accountId])).rows[0].count);
  const cashLedgerCount=Number((await client.query("select count(*) count from public.cash_ledger where account_id=$1",[accountId])).rows[0].count);
  assert(accountLedgerCount===cashLedgerCount,"현금 원장과 통합 원장 복제 건수 불일치");
  console.log(JSON.stringify({result:"PASS",buy:{gross:100000,fee:15,tax:0,net:-100015},sell:{gross:55000,fee:8.25,tax:82.5,net:54909.25},etfSellTax:0,weekendD2:"2026-09-15",settlements:settlements.length,cashLedgerEntries:cashLedgerCount,accountLedgerEntries:accountLedgerCount,rolledBack:true},null,2));
  await client.query("rollback");
}catch(error){await client.query("rollback").catch(()=>undefined);throw error;}finally{await client.end().catch(()=>undefined);}
