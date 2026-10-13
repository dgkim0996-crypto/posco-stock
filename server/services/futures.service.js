import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";
import { SIMULATED_USD_KRW } from "../../shared/tradingRules.js";
import alternativeMarketDataService, { FUTURES_MARKET_MAX_AGE_MS, futuresQuoteState } from "./alternativeMarketData.service.js";

const assetBySymbol = new Map(INITIAL_MARKETS.futures.map((asset) => [asset.symbol, asset]));
const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });

/** 계좌 ID를 안전한 양의 정수로 변환한다. */
function parseAccountId(value) {
  const accountId = Number(value);
  if (!Number.isInteger(accountId) || accountId <= 0) throw createError(400, "잘못된 계좌 ID 형식입니다.");
  return accountId;
}

/** DB 계좌 행을 API 응답용 camelCase 모델로 바꾼다. */
function mapAccount(row) {
  return { id: row.id, accountNumber: row.account_number, krwBalance: Number(row.krw_balance), usdBalance: Number(row.usd_balance) };
}

/** DB 선물 포지션 행을 화면이 사용하는 숫자형 모델로 변환한다. */
function mapPosition(row) {
  return { id: row.id, accountId: row.account_id, symbol: row.symbol, side: row.side, quantity: Number(row.quantity), entryPrice: Number(row.entry_price), multiplier: Number(row.multiplier), margin: Number(row.margin), createdAt: row.created_at };
}

/** 가격 1포인트당 원화 금액. 달러 표시 선물은 거래소 달러 승수에 모의환율을 곱해 원화로 정산한다. */
export function futuresKrwMultiplier(asset) {
  return asset.currency === "USD" ? asset.contractMultiplier * SIMULATED_USD_KRW : asset.multiplier;
}

/**
 * 제공처에서 최근 수신했고 거래소 체결시각도 신선한 시세만 체결가로 쓴다.
 * 정적 기준가로 대체하지 않으며, 조건을 만족하지 못하면 503으로 주문·청산을 거부한다.
 */
export async function tradableFuturesQuote(symbol, { quotes = alternativeMarketDataService, now = Date.now() } = {}) {
  const asset = assetBySymbol.get(symbol);
  if (!asset) throw createError(400, "지원하지 않는 선물 종목입니다.");
  const payload = await quotes.loadQuotes().catch(() => quotes.getCachedQuotes());
  const quote = payload?.items?.futures?.find((item) => item.symbol === symbol);
  const state = futuresQuoteState(quote, now);
  if (!state.tradable) {
    // 내부 원인을 담지 않은 고정 안내문이므로 5xx라도 사용자에게 그대로 보여 준다(errorHandler expose).
    if (state.reason === "MARKET_STALE") {
      throw Object.assign(createError(503, `${asset.name} 체결시세가 ${FUTURES_MARKET_MAX_AGE_MS / 60_000}분 넘게 갱신되지 않았습니다. 장 운영시간이 아니거나 시세가 지연되고 있어 주문을 처리할 수 없습니다.`), { expose: true });
    }
    throw Object.assign(createError(503, `${asset.name} 최신 시세를 받지 못해 주문을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.`), { expose: true, retryAfter: 30 });
  }
  return { asset, price: state.price };
}

/** RPC 오류 코드에 따라 사용자 입력 오류와 서버 오류를 구분한다. */
function translateRpcError(error) {
  if (error.code === "P0002") return createError(404, error.message, error);
  if (error.code === "P0001" || error.code === "22023") return createError(400, error.message, error);
  return createError(503, `선물 처리 실패: ${error.message}`, error);
}

/** 계좌의 모든 미결제 선물 포지션을 생성일 순으로 반환한다. */
async function getAll(accountIdValue) {
  const accountId = parseAccountId(accountIdValue);
  const { data, error } = await getSupabaseAdmin().from("futures_positions").select("*").eq("account_id", accountId).order("created_at");
  if (error) throw createError(503, `선물 포지션 조회 실패: ${error.message}`, error);
  return data.map(mapPosition);
}

/** 현재 시세·원화 환산 승수·증거금율을 전달해 선물 포지션을 원자적으로 개설한다. */
async function open(accountIdValue, { symbol, side, quantity }, { database = getSupabaseAdmin(), quotes, now } = {}) {
  const accountId = parseAccountId(accountIdValue);
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) throw createError(400, "계약 수는 1 이상의 정수여야 합니다.");
  const { asset, price } = await tradableFuturesQuote(symbol, { quotes, now });
  const { data, error } = await database.rpc("open_futures_position", { p_account_id: accountId, p_symbol: symbol, p_side: side, p_quantity: qty, p_entry_price: price, p_multiplier: futuresKrwMultiplier(asset), p_margin_rate: asset.marginRate });
  if (error) throw translateRpcError(error);
  return { account: mapAccount(data.account), position: mapPosition(data.position) };
}

/** 계좌 소유권을 확인한 포지션을 현재가로 청산하고 정산 결과를 반환한다. */
async function close(accountIdValue, positionId, { database = getSupabaseAdmin(), quotes, now } = {}) {
  const accountId = parseAccountId(accountIdValue);
  const { data: row, error: findError } = await database.from("futures_positions").select("symbol").eq("id", positionId).eq("account_id", accountId).maybeSingle();
  if (findError) throw createError(503, `선물 포지션 조회 실패: ${findError.message}`, findError);
  if (!row) throw createError(404, "선물 포지션을 찾을 수 없습니다.");
  const { price } = await tradableFuturesQuote(row.symbol, { quotes, now });
  const { data, error } = await database.rpc("close_futures_position", { p_account_id: accountId, p_position_id: positionId, p_current_price: price });
  if (error) throw translateRpcError(error);
  return {
    account: mapAccount(data.account), position: mapPosition(data.position), pnl: Number(data.pnl), payout: Number(data.payout), currentPrice: Number(data.current_price),
    cancelledPendingOrders: (data.cancelled_pending_orders || []).map((item) => ({ pendingOrderId: item.pending_order_id, orderId: item.order_id, releasedAmount: Number(item.released_amount) })),
  };
}

export default { getAll, open, close };
