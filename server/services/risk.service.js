import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";
import marketDataService from "./marketData.service.js";
import alternativeMarketDataService from "./alternativeMarketData.service.js";

const stockMap=new Map(INITIAL_MARKETS.stocks.map((asset)=>[asset.symbol,asset]));
const futureMap=new Map(INITIAL_MARKETS.futures.map((asset)=>[asset.symbol,asset]));
const createError=(status,message,cause)=>Object.assign(new Error(message),{status,cause});
const accountIdOf=(value)=>{const id=Number(value);if(!Number.isInteger(id)||id<=0)throw createError(400,"잘못된 계좌 ID입니다.");return id;};
const severity={SAFE:0,WARNING:1,MARGIN_CALL:2,LIQUIDATION:3};
const statusFor=(ratio,policy)=>ratio==null?"SAFE":ratio<=policy.liquidation?"LIQUIDATION":ratio<=policy.marginCall?"MARGIN_CALL":ratio<=policy.warning?"WARNING":"SAFE";

const evaluate=async(accountIdValue,{autoLiquidate=true}={})=>{
  const accountId=accountIdOf(accountIdValue);
  const [account,positions,contracts,holdings,shorts,policies,futureQuotes]=await Promise.all([
    getSupabaseAdmin().from("accounts").select("*").eq("id",accountId).single(),
    getSupabaseAdmin().from("futures_positions").select("*").eq("account_id",accountId),
    getSupabaseAdmin().from("finance_contracts").select("*").eq("account_id",accountId).eq("active",true),
    getSupabaseAdmin().from("holdings").select("symbol,quantity").eq("account_id",accountId).eq("category","stocks"),
    getSupabaseAdmin().from("short_positions").select("symbol,quantity,avg_price").eq("account_id",accountId),
    getSupabaseAdmin().from("risk_policies").select("*"),
    alternativeMarketDataService.loadQuotes().catch(()=>({items:{futures:[]}})),
  ]);
  const failure=[account,positions,contracts,holdings,shorts,policies].find((item)=>item.error);
  if(failure)throw createError(503,`위험 평가 조회 실패: ${failure.error.message}`,failure.error);
  const policyMap=Object.fromEntries(policies.data.map((row)=>[row.code,{warning:Number(row.warning_ratio),marginCall:Number(row.margin_call_ratio),liquidation:Number(row.liquidation_ratio)}]));
  const futuresPrices=new Map((futureQuotes.items?.futures||[]).map((item)=>[item.symbol,Number(item.price)]));
  const positionRisks=positions.data.map((row)=>{const fallback=futureMap.get(row.symbol);const price=futuresPrices.get(row.symbol)||Number(fallback?.price)||Number(row.entry_price);const direction=row.side==="LONG"?1:-1;const pnl=(price-Number(row.entry_price))*Number(row.multiplier)*Number(row.quantity)*direction;const equity=Number(row.margin)+pnl;const ratio=Number(row.margin)>0?equity/Number(row.margin):null;return{id:row.id,symbol:row.symbol,side:row.side,currentPrice:price,pnl,equity,margin:Number(row.margin),ratio,status:statusFor(ratio,policyMap.FUTURES)};});
  const futuresMargin=positionRisks.reduce((sum,item)=>sum+item.margin,0);const futuresEquity=positionRisks.reduce((sum,item)=>sum+item.equity,0);const futuresRatio=futuresMargin?futuresEquity/futuresMargin:null;
  const stockValue=holdings.data.reduce((sum,row)=>{const asset=stockMap.get(row.symbol);const live=marketDataService.getQuote(row.symbol)?.price;const price=Number.isFinite(live)?live:Number(asset?.price||0);return sum+price*(asset?.unit==="USD"?1380:1)*Number(row.quantity);},0);
  const shortValue=shorts.data.reduce((sum,row)=>{const asset=stockMap.get(row.symbol);const live=marketDataService.getQuote(row.symbol)?.price;const price=Number.isFinite(live)?live:Number(asset?.price||row.avg_price);return sum+price*(asset?.unit==="USD"?1380:1)*Number(row.quantity);},0);
  const debt=contracts.data.reduce((sum,row)=>sum+Number(row.debt||0),0);const locked=contracts.data.reduce((sum,row)=>sum+Number(row.locked_amount||0),0);const obligation=debt+shortValue;const financeEquity=Number(account.data.krw_balance)+stockValue+locked;const financeRatio=obligation?financeEquity/obligation:null;
  const futuresStatus=statusFor(futuresRatio,policyMap.FUTURES);const financeStatus=statusFor(financeRatio,policyMap.FINANCE);const status=severity[futuresStatus]>=severity[financeStatus]?futuresStatus:financeStatus;
  const requiredMargin=futuresMargin*(policyMap.FUTURES?.marginCall||.75)+obligation*(policyMap.FINANCE?.marginCall||1.4);const equity=futuresEquity+financeEquity;const deficit=Math.max(0,requiredMargin-equity);
  const details={futures:{status:futuresStatus,equity:futuresEquity,initialMargin:futuresMargin,ratio:futuresRatio,positions:positionRisks},finance:{status:financeStatus,equity:financeEquity,obligation,ratio:financeRatio,stockValue,shortValue,debt,locked}};
  const latest=await getSupabaseAdmin().from("risk_snapshots").select("status,created_at").eq("account_id",accountId).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(latest.error)throw createError(503,`최근 위험 상태 조회 실패: ${latest.error.message}`,latest.error);
  const shouldRecord=!latest.data||latest.data.status!==status||Date.now()-new Date(latest.data.created_at).getTime()>=300000;
  if(shouldRecord){const snapshot=await getSupabaseAdmin().rpc("record_risk_snapshot",{p_account_id:accountId,p_status:status,p_equity:equity,p_required_margin:requiredMargin,p_margin_ratio:requiredMargin?equity/requiredMargin:null,p_deficit:deficit,p_details:details});if(snapshot.error)throw createError(503,`위험 스냅샷 기록 실패: ${snapshot.error.message}`,snapshot.error);}
  const liquidations=[];
  if(autoLiquidate&&futuresStatus==="LIQUIDATION")for(const position of positionRisks.filter((item)=>item.status==="LIQUIDATION")){
    const result=await getSupabaseAdmin().rpc("force_liquidate_futures_position",{p_account_id:accountId,p_position_id:position.id,p_current_price:position.currentPrice});
    if(result.error)throw createError(503,`강제청산 실패: ${result.error.message}`,result.error);
    liquidations.push({positionId:position.id,symbol:position.symbol,pnl:Number(result.data.pnl),payout:Number(result.data.payout),deficit:Number(result.data.deficit)});
  }
  const finalAccount=await getSupabaseAdmin().from("accounts").select("krw_balance").eq("id",accountId).single();
  const remaining=await getSupabaseAdmin().from("futures_positions").select("*").eq("account_id",accountId).order("created_at");
  return{status,equity,requiredMargin,deficit,details,liquidations,account:{krwBalance:Number(finalAccount.data.krw_balance)},futuresPositions:remaining.data.map((row)=>({id:row.id,symbol:row.symbol,side:row.side,quantity:Number(row.quantity),entryPrice:Number(row.entry_price),multiplier:Number(row.multiplier),margin:Number(row.margin),createdAt:row.created_at}))};
};
export default{evaluate};
