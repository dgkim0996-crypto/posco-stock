import { getSupabaseAdmin } from "../lib/supabase.js";
import marketDataService from "./marketData.service.js";
import alternativeMarketDataService from "./alternativeMarketData.service.js";
import { assertOrderCapacity } from "./orderCapacity.service.js";
import { clientOrderIdOf, getOrderRequest } from "./orderIdempotency.service.js";
import { accountIdOf, assertLimitCrossed, bindPendingOrder, orderError as createError, pendingIdOf, quoteIsFresh, toKrwPrice, validateSpotOrder } from "./spotOrderValidation.js";

/** Supabase의 snake_case 계좌 행을 API의 camelCase 응답으로 변환한다. */
const mapAccount = (row) => ({
  id: row.id,
  accountNumber: row.account_number,
  krwBalance: Number(row.krw_balance),
  usdBalance: Number(row.usd_balance),
});

/** 주문 결과에 포함된 보유잔고 행을 화면에서 쓰는 형태로 변환한다. */
const mapHolding = (row) => row && ({
  id: row.id,
  accountId: row.account_id,
  symbol: row.symbol,
  category: row.category,
  quantity: Number(row.quantity),
  avgPrice: Number(row.avg_price),
});

/** 주문 행에 체결·취소·수수료 필드를 포함해 일관된 응답 모델로 변환한다. */
const mapOrder = (row) => ({
  id: row.id,
  accountId: row.account_id,
  symbol: row.symbol,
  category: row.category,
  side: row.side,
  orderType: row.order_type,
  quantity: Number(row.quantity),
  requestedPrice: row.requested_price == null ? null : Number(row.requested_price),
  price: Number(row.execution_price),
  totalAmount: Number(row.total_amount),
  status: row.status,
  filledQuantity: Number(row.filled_quantity ?? (row.status === "FILLED" ? row.quantity : 0)),
  remainingQuantity: Number(row.remaining_quantity || 0),
  cancelledQuantity: Number(row.cancelled_quantity || 0),
  feeAmount: Number(row.fee_amount || 0),
  taxAmount: Number(row.tax_amount || 0),
  transactionTaxAmount: Number(row.transaction_tax_amount || 0),
  agriculturalTaxAmount: Number(row.agricultural_tax_amount || 0),
  settlementDate: row.settlement_date || null,
  updatedAt: row.updated_at || row.created_at,
  borrowedQuantity: Number(row.borrowed_quantity || 0),
  coveredQuantity: Number(row.covered_quantity || 0),
  createdAt: row.created_at,
});

/** 오래된 캐시·초기 표시값으로 체결하지 않고 서버가 확인한 시장 데이터만 사용한다. */
export const executionQuoteFor = async (input, market = marketDataService, alternative = alternativeMarketDataService, { refresh = true } = {}) => {
  let quote;
  const maxAgeMs = input.asset.category === "bonds" ? 7 * 86_400_000 : 120_000;
  try {
    if (input.asset.synthetic) {
      const components = await Promise.all(input.asset.components.map(async (symbol) => {
        let component = market.getQuote(symbol);
        if (refresh && !quoteIsFresh(component, maxAgeMs)) component = await market.fetchQuote(symbol);
        if (!quoteIsFresh(component, maxAgeMs) || !Number.isFinite(component.change)) throw createError(503, "합성 상품의 최신 기초시세가 없습니다.");
        return component;
      }));
      const change = Math.max(-99, Math.min(99, components.reduce((sum, item) => sum + item.change, 0) / components.length * input.asset.leverage));
      const price = toKrwPrice(input.asset, Math.max(100, 10000 * (1 + change / 100)));
      return { price, nativePrice: price, source: "기초종목 시세 기반 모의 합성", isSimulation: true,
        updatedAt: new Date(Math.max(...components.map((item) => Date.parse(item.updatedAt)))).toISOString() };
    }
    if (input.asset.category === "stocks") {
      quote = market.getQuote(input.symbol);
      if (refresh && !quoteIsFresh(quote, maxAgeMs)) quote = await market.fetchQuote(input.symbol);
    } else {
      const payload = refresh ? await alternative.loadQuotes() : alternative.getCachedQuotes();
      const row = payload?.items?.[input.asset.category]?.find((item) => item.symbol === input.symbol);
      const date = row?.priceUpdatedAt?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
      quote = row && { ...row, source: row.priceSource, updatedAt: date };
    }
  } catch (error) {
    throw createError(503, "최신 시세를 확인할 수 없어 주문을 체결하지 않았습니다. 잠시 후 다시 시도해 주세요.", error);
  }
  if (!quoteIsFresh(quote, maxAgeMs)) throw createError(503, "유효한 최신 시세가 없어 주문을 체결할 수 없습니다.");
  return { price: toKrwPrice(input.asset, quote.price), nativePrice: quote.price,
    source: quote.source, updatedAt: quote.updatedAt, isSimulation: true };
};

/** 시장가 또는 체결 조건을 만족한 지정가 주문을 RPC로 원자 처리하고 최종 잔고를 반환한다. */
const createOrder = async (payload, { database = getSupabaseAdmin(), quoteFor = executionQuoteFor, capacity = assertOrderCapacity } = {}) => {
  let input;
  if (payload.pendingOrderId != null) {
    const accountId = accountIdOf(payload.accountId);
    const pendingOrderId = pendingIdOf(payload.pendingOrderId);
    const { data, error } = await database.from("pending_orders").select("*")
      .eq("id", pendingOrderId).eq("account_id", accountId).maybeSingle();
    if (error) throw createError(503, "미체결 주문 조회에 실패했습니다.", error);
    input = bindPendingOrder({ ...payload, accountId, pendingOrderId }, data);
  } else {
    input = validateSpotOrder(payload);
  }
  const requestedPrice = input.requestedPrice == null ? null : toKrwPrice(input.asset, input.requestedPrice);
  const clientOrderId = input.pendingOrderId ? null : clientOrderIdOf(payload.clientOrderId);
  if (clientOrderId) {
    const cached = await getOrderRequest({ ...input, clientOrderId, kind: "SPOT", category: input.asset.category, price: requestedPrice }, database);
    if (cached) return mapResult(cached, null, true);
  }
  const executionQuote = await quoteFor(input);
  const executionPrice = executionQuote.price;
  assertLimitCrossed(input, executionPrice);
  const fillQuantity = input.fillQuantity ?? input.quantity;
  await capacity({ ...input, quantity: fillQuantity, price: executionPrice,
    remainingQuantity: input.pendingOrderId ? input.quantity - fillQuantity : 0, remainingPrice: requestedPrice ?? executionPrice }, database);
  const request = input.pendingOrderId
    ? database.rpc("place_pending_spot_order", {
      p_account_id: input.accountId, p_pending_order_id: input.pendingOrderId, p_execution_price: executionPrice,
      p_fill_quantity: fillQuantity,
    })
    : database.rpc("place_spot_order_once", {
      p_account_id: input.accountId, p_symbol: input.symbol, p_category: input.asset.category,
      p_side: input.side, p_order_type: input.orderType, p_quantity: input.quantity,
      p_requested_price: requestedPrice, p_execution_price: executionPrice,
      p_client_order_id: clientOrderId,
    });
  const { data, error } = await request;
  if (error) {
    if (error.code === "P4090") throw createError(409, error.message, error);
    if (error.code === "P0002") throw createError(404, error.message, error);
    if (error.code === "P0001" || error.code === "22023") {
      throw createError(400, error.message, error);
    }
    throw createError(503, `주문 처리 실패: ${error.message}`, error);
  }
  if (clientOrderId) return mapResult(data, executionQuote);
  // 수수료 트리거가 원금 처리 직후 계좌·주문을 갱신하므로 RPC 내부의 이전 스냅샷 대신 최종 행을 다시 읽는다.
  const [finalAccount, finalOrder] = await Promise.all([
    database.from("accounts").select("*").eq("id", input.accountId).single(),
    database.from("orders").select("*").eq("id", data.order.id).single(),
  ]);
  if (finalAccount.error || finalOrder.error) throw createError(503, "수수료 반영 결과 조회에 실패했습니다.", finalAccount.error || finalOrder.error);
  return mapResult({ ...data, order: finalOrder.data, account: finalAccount.data }, executionQuote);
};

const mapResult = (data, executionQuote, replayed = false) => ({
    executionQuote, replayed,
    order: mapOrder(data.order), account: mapAccount(data.account), holding: mapHolding(data.holding),
    shortPosition: data.short_position && {
      accountId: data.short_position.account_id,
      symbol: data.short_position.symbol,
      quantity: Number(data.short_position.quantity),
      avgPrice: Number(data.short_position.avg_price),
    },
  });

/** 한 계좌의 최근 체결 주문 100건을 최신순으로 조회한다. */
const getAll = async (accountIdValue) => {
  let query = getSupabaseAdmin().from("orders").select("*");
  if (accountIdValue !== undefined) {
    const accountId = Number(accountIdValue);
    if (!Number.isInteger(accountId) || accountId <= 0) throw createError(400, "잘못된 accountId입니다.");
    query = query.eq("account_id", accountId);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) throw createError(503, `주문내역 조회 실패: ${error.message}`, error);
  return data.map(mapOrder);
};

export default { createOrder, getAll };
