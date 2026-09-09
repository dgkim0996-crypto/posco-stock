import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";

const assetMap = new Map(Object.values(INITIAL_MARKETS).flat().map((asset) => [asset.symbol, asset]));
const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });

const validateAccountId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw createError(400, "잘못된 계좌 ID 형식입니다.");
  return id;
};

const mapAccount = (row) => row && ({
  id: row.id,
  accountNumber: row.account_number,
  krwBalance: Number(row.krw_balance),
  usdBalance: Number(row.usd_balance),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapHolding = (row) => {
  const asset = assetMap.get(row.symbol);
  const quantity = Number(row.quantity);
  const avgPrice = Number(row.avg_price);
  const rawCurrentPrice = Number(asset?.price ?? 0);
  const currentPrice = asset?.unit === "USD" ? rawCurrentPrice * 1380 : rawCurrentPrice;
  const marketValue = currentPrice * quantity;
  return {
    id: row.id,
    accountId: row.account_id,
    symbol: row.symbol,
    category: row.category,
    quantity,
    avgPrice,
    name: asset?.name ?? row.symbol,
    currentPrice,
    marketValue,
    profitLoss: marketValue - avgPrice * quantity,
  };
};

const getById = async (value) => {
  const id = validateAccountId(value);
  const { data, error } = await getSupabaseAdmin().from("accounts").select("*").eq("id", id).maybeSingle();
  if (error) throw createError(503, `계좌 조회 실패: ${error.message}`, error);
  return mapAccount(data);
};

const getHoldings = async (value) => {
  const accountId = validateAccountId(value);
  const [accountResult, holdingsResult] = await Promise.all([
    getSupabaseAdmin().from("accounts").select("id").eq("id", accountId).maybeSingle(),
    getSupabaseAdmin().from("holdings").select("*").eq("account_id", accountId).order("created_at"),
  ]);
  if (accountResult.error) throw createError(503, `계좌 조회 실패: ${accountResult.error.message}`, accountResult.error);
  if (!accountResult.data) return null;
  if (holdingsResult.error) throw createError(503, `보유종목 조회 실패: ${holdingsResult.error.message}`, holdingsResult.error);
  return { items: holdingsResult.data.map(mapHolding) };
};

const rpcError = (error) => {
  if (error.code === "P0002") return createError(404, error.message, error);
  if (error.code === "P0001" || error.code === "22023") return createError(400, error.message, error);
  return createError(503, `계좌 작업 실패: ${error.message}`, error);
};

const applyCashOperation = async (accountIdValue, operation, amountValue) => {
  const accountId = validateAccountId(accountIdValue);
  const amount = Number(amountValue);
  if (!Number.isFinite(amount) || amount <= 0) throw createError(400, "금액이 올바르지 않습니다.");
  const { data, error } = await getSupabaseAdmin().rpc("apply_cash_operation", {
    p_account_id: accountId, p_operation: operation, p_amount: amount, p_usd_krw: 1380,
  });
  if (error) throw rpcError(error);
  return { account: mapAccount(data.account), krwDelta: Number(data.krw_delta), usdDelta: Number(data.usd_delta) };
};

const reset = async (accountIdValue) => {
  const accountId = validateAccountId(accountIdValue);
  const { data, error } = await getSupabaseAdmin().rpc("reset_demo_account", { p_account_id: accountId, p_starting_cash: 10000000 });
  if (error) throw rpcError(error);
  return mapAccount(data);
};

// 감사 원장은 잔액이 왜 변했는지 추적하는 읽기 전용 기록이다.
const getLedger = async (accountIdValue, limitValue = 100) => {
  const accountId = validateAccountId(accountIdValue);
  const limit = Math.max(1, Math.min(200, Number(limitValue) || 100));
  const { data, error } = await getSupabaseAdmin().from("account_ledger").select("*")
    .eq("account_id", accountId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw createError(503, `계좌 원장 조회 실패: ${error.message}`, error);
  return data.map((row) => ({
    id: row.id, eventType: row.event_type, currency: row.currency, amount: Number(row.amount),
    balanceBefore: row.balance_before == null ? null : Number(row.balance_before), balanceAfter: Number(row.balance_after),
    referenceType: row.reference_type, referenceId: row.reference_id, metadata: row.metadata || {}, createdAt: row.created_at,
  }));
};

// 주문 이벤트는 접수부터 체결까지의 상태 전이를 순서대로 제공한다.
const getOrderEvents = async (accountIdValue, limitValue = 200) => {
  const accountId = validateAccountId(accountIdValue);
  const limit = Math.max(1, Math.min(300, Number(limitValue) || 200));
  const { data, error } = await getSupabaseAdmin().from("order_events").select("*")
    .eq("account_id", accountId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) throw createError(503, `주문 이벤트 조회 실패: ${error.message}`, error);
  return data.map((row) => ({
    id: row.id, orderId: row.order_id, eventType: row.event_type, filledQuantity: Number(row.filled_quantity),
    remainingQuantity: Number(row.remaining_quantity), executionPrice: row.execution_price == null ? null : Number(row.execution_price),
    reason: row.reason, metadata: row.metadata || {}, createdAt: row.created_at,
  }));
};

const getState = async (accountIdValue) => {
  const accountId = validateAccountId(accountIdValue);
  const [account, holdings, shorts, futures, finance, orders, pendingOrders] = await Promise.all([
    getSupabaseAdmin().from("accounts").select("*").eq("id", accountId).maybeSingle(),
    getSupabaseAdmin().from("holdings").select("*").eq("account_id", accountId),
    getSupabaseAdmin().from("short_positions").select("*").eq("account_id", accountId),
    getSupabaseAdmin().from("futures_positions").select("*").eq("account_id", accountId).order("created_at"),
    getSupabaseAdmin().from("finance_contracts").select("*").eq("account_id", accountId),
    getSupabaseAdmin().from("orders").select("*").eq("account_id", accountId).order("created_at", { ascending:false }).limit(100),
    getSupabaseAdmin().from("pending_orders").select("*").eq("account_id", accountId).order("created_at", { ascending:false }),
  ]);
  const failed = [account, holdings, shorts, futures, finance, orders, pendingOrders].find((result) => result.error);
  if (failed) throw createError(503, `계좌 상태 조회 실패: ${failed.error.message}`, failed.error);
  if (!account.data) return null;
  const contracts = Object.fromEntries(["credit","margin","lending","collateral"].map((key)=>[key,{active:false,limit:0,debt:0,locked:0}]));
  finance.data.forEach((row)=>{contracts[row.product_type]={active:Boolean(row.active),limit:Number(row.limit_amount),debt:Number(row.debt),locked:Number(row.locked_amount)};});
  return {
    account: mapAccount(account.data),
    holdings: holdings.data.map((row)=>({symbol:row.symbol,category:row.category,quantity:Number(row.quantity),avgPrice:Number(row.avg_price)})),
    shortPositions: shorts.data.map((row)=>({symbol:row.symbol,quantity:Number(row.quantity),avgPrice:Number(row.avg_price)})),
    futuresPositions: futures.data.map((row)=>({id:row.id,symbol:row.symbol,side:row.side,quantity:Number(row.quantity),entryPrice:Number(row.entry_price),multiplier:Number(row.multiplier),margin:Number(row.margin),createdAt:row.created_at})),
    finance: contracts,
    orders: orders.data.map((row)=>({id:row.id,symbol:row.symbol,category:row.category,side:row.side,orderType:row.order_type,quantity:Number(row.quantity),limitPrice:row.requested_price==null?null:Number(row.requested_price),executionPrice:Number(row.execution_price),borrowedQuantity:Number(row.borrowed_quantity||0),coveredQuantity:Number(row.covered_quantity||0),filledQuantity:Number(row.filled_quantity ?? (row.status==='FILLED'?row.quantity:0)),remainingQuantity:Number(row.remaining_quantity ?? 0),cancelledQuantity:Number(row.cancelled_quantity||0),feeAmount:Number(row.fee_amount||0),taxAmount:Number(row.tax_amount||0),settlementDate:row.settlement_date||null,createdAt:row.created_at,updatedAt:row.updated_at||row.created_at,status:row.status})),
    pendingOrders: pendingOrders.data.map((row)=>{const factor=assetMap.get(row.symbol)?.unit==="USD"?1380:1;return{id:row.id,orderId:row.order_id||null,symbol:row.symbol,category:row.category,side:row.side,quantity:Number(row.quantity),limitPrice:Number(row.limit_price)/factor,createdAt:row.created_at};}),
  };
};

export default { getById, getHoldings, applyCashOperation, reset, getLedger, getOrderEvents, getState };
