import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";
import marketDataService from "./marketData.service.js";

const spotAssets = Object.entries(INITIAL_MARKETS)
  .filter(([category]) => category !== "futures")
  .flatMap(([category, assets]) => assets.map((asset) => [asset.symbol, { ...asset, category }]));
const assetMap = new Map(spotAssets);
const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });

const validateOrder = ({ accountId, symbol, side, quantity, orderType = "MARKET", requestedPrice, pendingOrderId, fillQuantity }) => {
  const parsedAccountId = Number(accountId);
  const parsedQuantity = Number(quantity);
  const normalizedSymbol = typeof symbol === "string" ? symbol.trim() : "";
  const asset = assetMap.get(normalizedSymbol);
  if (!Number.isInteger(parsedAccountId) || parsedAccountId <= 0) throw createError(400, "잘못된 accountId입니다.");
  if (!asset) throw createError(400, "지원하지 않는 현물 종목입니다.");
  if (!["BUY", "SELL"].includes(side)) throw createError(400, "side는 BUY 또는 SELL이어야 합니다.");
  if (!["MARKET", "LIMIT"].includes(orderType)) throw createError(400, "orderType은 MARKET 또는 LIMIT이어야 합니다.");
  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) throw createError(400, "quantity는 0보다 큰 숫자여야 합니다.");
  if (asset.category !== "crypto" && !Number.isInteger(parsedQuantity)) throw createError(400, "주식과 채권 주문수량은 정수여야 합니다.");
  const parsedRequestedPrice = requestedPrice == null ? null : Number(requestedPrice);
  if (parsedRequestedPrice != null && (!Number.isFinite(parsedRequestedPrice) || parsedRequestedPrice <= 0)) {
    throw createError(400, "requestedPrice는 0보다 커야 합니다.");
  }
  const parsedFillQuantity = fillQuantity == null ? null : Number(fillQuantity);
  if (parsedFillQuantity != null && (!Number.isFinite(parsedFillQuantity) || parsedFillQuantity <= 0 || parsedFillQuantity > parsedQuantity)) {
    throw createError(400, "fillQuantity는 0보다 크고 미체결 수량 이하여야 합니다.");
  }
  if (parsedFillQuantity != null && asset.category !== "crypto" && !Number.isInteger(parsedFillQuantity)) {
    throw createError(400, "주식과 채권의 부분체결 수량은 정수여야 합니다.");
  }
  return { accountId: parsedAccountId, symbol: normalizedSymbol, side, quantity: parsedQuantity, orderType, requestedPrice: parsedRequestedPrice, pendingOrderId, fillQuantity: parsedFillQuantity, asset };
};

const mapAccount = (row) => ({
  id: row.id,
  accountNumber: row.account_number,
  krwBalance: Number(row.krw_balance),
  usdBalance: Number(row.usd_balance),
});

const mapHolding = (row) => row && ({
  id: row.id,
  accountId: row.account_id,
  symbol: row.symbol,
  category: row.category,
  quantity: Number(row.quantity),
  avgPrice: Number(row.avg_price),
});

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
  settlementDate: row.settlement_date || null,
  updatedAt: row.updated_at || row.created_at,
  borrowedQuantity: Number(row.borrowed_quantity || 0),
  coveredQuantity: Number(row.covered_quantity || 0),
  createdAt: row.created_at,
});

const executionPriceFor = (input) => {
  const livePrice = marketDataService.getQuote(input.symbol)?.price;
  const nativePrice = Number.isFinite(livePrice) ? livePrice : Number(input.asset.price);
  return input.asset.unit === "USD" ? nativePrice * 1380 : nativePrice;
};

const createOrder = async (payload) => {
  const input = validateOrder(payload);
  const executionPrice = executionPriceFor(input);
  const requestedPrice = input.requestedPrice == null ? null : input.requestedPrice * (input.asset.unit === "USD" ? 1380 : 1);
  if (!input.pendingOrderId && input.orderType === "LIMIT") {
    if (requestedPrice == null) throw createError(400, "지정가 주문에는 requestedPrice가 필요합니다.");
    const crossed = input.side === "BUY"
      ? executionPrice <= requestedPrice : executionPrice >= requestedPrice;
    if (!crossed) throw createError(400, "아직 지정가 체결 조건에 도달하지 않았습니다.");
  }
  const request = input.pendingOrderId
    ? getSupabaseAdmin().rpc("place_pending_spot_order", {
      p_account_id: input.accountId, p_pending_order_id: input.pendingOrderId, p_execution_price: executionPrice,
      p_fill_quantity: input.fillQuantity ?? input.quantity,
    })
    : getSupabaseAdmin().rpc("place_spot_order", {
      p_account_id: input.accountId, p_symbol: input.symbol, p_category: input.asset.category,
      p_side: input.side, p_order_type: input.orderType, p_quantity: input.quantity,
      p_requested_price: requestedPrice, p_execution_price: executionPrice,
    });
  const { data, error } = await request;
  if (error) {
    if (error.code === "P0002") throw createError(404, error.message, error);
    if (error.code === "P0001" || error.code === "22023") {
      throw createError(400, error.message, error);
    }
    throw createError(503, `주문 처리 실패: ${error.message}`, error);
  }
  // 수수료 트리거가 원금 처리 직후 계좌·주문을 갱신하므로 RPC 내부의 이전 스냅샷 대신 최종 행을 다시 읽는다.
  const [finalAccount, finalOrder] = await Promise.all([
    getSupabaseAdmin().from("accounts").select("*").eq("id", input.accountId).single(),
    getSupabaseAdmin().from("orders").select("*").eq("id", data.order.id).single(),
  ]);
  if (finalAccount.error || finalOrder.error) throw createError(503, "수수료 반영 결과 조회에 실패했습니다.", finalAccount.error || finalOrder.error);
  return {
    order: mapOrder(finalOrder.data), account: mapAccount(finalAccount.data), holding: mapHolding(data.holding),
    shortPosition: data.short_position && {
      accountId: data.short_position.account_id,
      symbol: data.short_position.symbol,
      quantity: Number(data.short_position.quantity),
      avgPrice: Number(data.short_position.avg_price),
    },
  };
};

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
