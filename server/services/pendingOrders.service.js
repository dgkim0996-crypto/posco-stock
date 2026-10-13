import { getSupabaseAdmin } from "../lib/supabase.js";
import { accountIdOf, fromKrwPrice, limitPriceOf, orderError as createError, pendingIdOf, quantityOf, spotAssets as assets, toKrwPrice } from "./spotOrderValidation.js";
import { assertOrderCapacity } from "./orderCapacity.service.js";
import { clientOrderIdOf, getOrderRequest } from "./orderIdempotency.service.js";

/** DB의 미체결 주문 행을 화면에서 사용하는 예약 주문 모델로 변환한다. */
const mapPendingOrder = (row) => ({
  id: row.id,
  accountId: row.account_id,
  symbol: row.symbol,
  category: row.category,
  side: row.side,
  quantity: Number(row.quantity),
  limitPrice: fromKrwPrice(assets.get(row.symbol), row.limit_price),
  orderId: row.order_id || null,
  reservedAmount: Number(row.reserved_amount || 0),
  createdAt: row.created_at,
});

/** 특정 계좌의 활성 미체결 주문을 최신순으로 읽는다. */
const getAll = async (value) => {
  const accountId = accountIdOf(value);
  const { data, error } = await getSupabaseAdmin().from("pending_orders")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw createError(503, `미체결 주문 조회 실패: ${error.message}`, error);
  return data.map(mapPendingOrder);
};

/** 지정가 주문을 만들고 매수 시 필요한 예약 금액을 함께 계산한다. */
const create = async (value, payload, { database = getSupabaseAdmin(), capacity = assertOrderCapacity } = {}) => {
  const accountId = accountIdOf(value);
  const asset = assets.get(typeof payload.symbol === "string" ? payload.symbol.trim() : "");
  if (!asset) throw createError(400, "지원하지 않는 현물 종목입니다.");
  if (!["BUY", "SELL"].includes(payload.side)) throw createError(400, "주문 방향이 올바르지 않습니다.");
  const quantity = quantityOf(payload.quantity, asset);
  const limitPrice = limitPriceOf(payload.limitPrice, asset);

  const databaseLimitPrice = toKrwPrice(asset, limitPrice);
  const clientOrderId = clientOrderIdOf(payload.clientOrderId);
  const cached = await getOrderRequest({ accountId, clientOrderId, kind: "PENDING", symbol: asset.symbol, category: asset.category, side: payload.side, quantity, orderType: "LIMIT", price: databaseLimitPrice }, database);
  if (cached) return { ...mapPendingOrder(cached.pending_order), replayed: true };
  const { reservedAmount: reservationAmount } = await capacity({ accountId, asset, side: payload.side, quantity, price: databaseLimitPrice }, database);
  const { data, error } = await database.rpc("create_pending_spot_order_once", {
    p_account_id: accountId, p_symbol: asset.symbol, p_category: asset.category,
    p_side: payload.side, p_quantity: quantity, p_limit_price: databaseLimitPrice,
    p_reservation_amount: reservationAmount,
    p_client_order_id: clientOrderId,
  });
  if (error) {
    if (error.code === "P4090") throw createError(409, error.message, error);
    if (error.code === "23503" || error.code === "P0002") throw createError(404, "계좌를 찾을 수 없습니다.", error);
    if (error.code === "P0001" || error.code === "22023") throw createError(400, error.message, error);
    throw createError(503, `미체결 주문 저장 실패: ${error.message}`, error);
  }
  return { ...mapPendingOrder(data.pending_order), orderId: data.order?.id || data.pending_order.order_id || null };
};

/** 소유 계좌 조건을 포함해 미체결 주문을 취소한다. */
const remove = async (value, pendingId) => {
  const accountId = accountIdOf(value);
  pendingIdOf(pendingId);
  const { data, error } = await getSupabaseAdmin().rpc("cancel_pending_spot_order", {
    p_account_id: accountId, p_pending_order_id: pendingId,
  });
  if (error) {
    if (error.code === "P0002") throw createError(404, error.message, error);
    if (error.code === "P0001" || error.code === "22023") throw createError(400, error.message, error);
    throw createError(503, `미체결 주문 취소 실패: ${error.message}`, error);
  }
  return { id: data.pending_order_id, order: data.order || null };
};

const REMAINING_CHANGED = "정정 화면을 연 사이 주문이 체결되어 잔여수량이 바뀌었습니다. 최신 미체결 내역을 확인한 뒤 다시 정정해 주세요.";

/** 주문 수량·가격을 변경하고 그에 따른 예약 금액을 다시 반영한다. */
const amend = async (value, pendingId, payload, { database = getSupabaseAdmin(), capacity = assertOrderCapacity } = {}) => {
  const accountId = accountIdOf(value);
  pendingIdOf(pendingId);
  const { data: pending, error: lookupError } = await database.from("pending_orders")
    .select("symbol,category,side,quantity").eq("id", pendingId).eq("account_id", accountId).maybeSingle();
  if (lookupError) throw createError(503, `미체결 주문 조회 실패: ${lookupError.message}`, lookupError);
  if (!pending) throw createError(404, "미체결 주문을 찾을 수 없습니다.");
  const asset = assets.get(pending.symbol);
  if (!asset) throw createError(400, "지원하지 않는 현물 종목입니다.");
  const quantity = quantityOf(payload.quantity, asset);
  const limitPrice = limitPriceOf(payload.limitPrice, asset);
  // 정정 창을 연 사이 부분체결되면 "체결수량+새 잔량"으로 총수량이 늘어난다. 화면이 본 잔량을 DB가 잠금 후 다시 비교한다.
  // expectedRemaining이 없는 이전 클라이언트는 방금 조회한 잔량을 기준으로 삼는다.
  const expectedRemaining = payload.expectedRemaining == null ? Number(pending.quantity) : quantityOf(payload.expectedRemaining, asset);
  if (expectedRemaining !== Number(pending.quantity)) throw createError(409, REMAINING_CHANGED);
  const databaseLimitPrice = toKrwPrice(asset, limitPrice);
  const { reservedAmount } = await capacity({ accountId, asset, side: pending.side, quantity, price: databaseLimitPrice, pendingOrderId: pendingId }, database);
  // 020 이전 RPC는 매도에도 양수 예약값을 요구한다. 실제 매수 예약 합계에는 포함되지 않는다.
  const reservationAmount = pending.side === "BUY" ? reservedAmount : quantity * databaseLimitPrice;
  const { data, error } = await database.rpc("amend_pending_spot_order", {
    p_account_id: accountId, p_pending_order_id: pendingId, p_quantity: quantity,
    p_limit_price: databaseLimitPrice, p_reservation_amount: reservationAmount,
    p_expected_remaining: expectedRemaining,
  });
  if (error) {
    if (error.code === "P4090") throw createError(409, error.message || REMAINING_CHANGED, error);
    if (error.code === "P0002") throw createError(404, error.message, error);
    if (error.code === "P0001" || error.code === "22023") throw createError(400, error.message, error);
    throw createError(503, `주문 정정 실패: ${error.message}`, error);
  }
  return { ...mapPendingOrder(data.pending_order), order: data.order || null };
};

export default { getAll, create, remove, amend };
