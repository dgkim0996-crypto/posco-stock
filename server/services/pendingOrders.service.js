import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";

const assets = new Map(Object.entries(INITIAL_MARKETS)
  .filter(([category]) => category !== "futures")
  .flatMap(([category, list]) => list.map((asset) => [asset.symbol, { ...asset, category }])));
const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });

/** API에서 온 계좌 ID가 DB 조회에 안전한 양의 정수인지 확인한다. */
const accountIdOf = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw createError(400, "잘못된 계좌 ID 형식입니다.");
  return id;
};

/** DB의 미체결 주문 행을 화면에서 사용하는 예약 주문 모델로 변환한다. */
const mapPendingOrder = (row) => ({
  id: row.id,
  accountId: row.account_id,
  symbol: row.symbol,
  category: row.category,
  side: row.side,
  quantity: Number(row.quantity),
  limitPrice: Number(row.limit_price) / (assets.get(row.symbol)?.unit === "USD" ? 1380 : 1),
  orderId: row.order_id || null,
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
const create = async (value, payload) => {
  const accountId = accountIdOf(value);
  const asset = assets.get(typeof payload.symbol === "string" ? payload.symbol.trim() : "");
  const quantity = Number(payload.quantity);
  const limitPrice = Number(payload.limitPrice);
  if (!asset) throw createError(400, "지원하지 않는 현물 종목입니다.");
  if (!["BUY", "SELL"].includes(payload.side)) throw createError(400, "주문 방향이 올바르지 않습니다.");
  if (!Number.isFinite(quantity) || quantity <= 0 || (!Number.isInteger(quantity) && asset.category !== "crypto")) {
    throw createError(400, "주문수량이 올바르지 않습니다.");
  }
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) throw createError(400, "지정가가 올바르지 않습니다.");

  const priceFactor = asset.unit === "USD" ? 1380 : 1;
  const databaseLimitPrice = limitPrice * priceFactor;
  const reservationAmount = quantity * databaseLimitPrice;
  const { data, error } = await getSupabaseAdmin().rpc("create_pending_spot_order", {
    p_account_id: accountId, p_symbol: asset.symbol, p_category: asset.category,
    p_side: payload.side, p_quantity: quantity, p_limit_price: databaseLimitPrice,
    p_reservation_amount: reservationAmount,
  });
  if (error) {
    if (error.code === "23503") throw createError(404, "계좌를 찾을 수 없습니다.", error);
    if (error.code === "P0001" || error.code === "22023") throw createError(400, error.message, error);
    throw createError(503, `미체결 주문 저장 실패: ${error.message}`, error);
  }
  return { ...mapPendingOrder(data.pending_order), orderId: data.order?.id || data.pending_order.order_id || null };
};

/** 소유 계좌 조건을 포함해 미체결 주문을 취소한다. */
const remove = async (value, pendingId) => {
  const accountId = accountIdOf(value);
  const { data, error } = await getSupabaseAdmin().rpc("cancel_pending_spot_order", {
    p_account_id: accountId, p_pending_order_id: pendingId,
  });
  if (error) {
    if (error.code === "P0002") throw createError(404, error.message, error);
    throw createError(503, `미체결 주문 취소 실패: ${error.message}`, error);
  }
  return { id: data.pending_order_id, order: data.order || null };
};

/** 주문 수량·가격을 변경하고 그에 따른 예약 금액을 다시 반영한다. */
const amend = async (value, pendingId, payload) => {
  const accountId = accountIdOf(value);
  const quantity = Number(payload.quantity);
  const limitPrice = Number(payload.limitPrice);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(limitPrice) || limitPrice <= 0) {
    throw createError(400, "정정 수량과 가격이 올바르지 않습니다.");
  }
  const { data: pending, error: lookupError } = await getSupabaseAdmin().from("pending_orders")
    .select("symbol,category").eq("id", pendingId).eq("account_id", accountId).maybeSingle();
  if (lookupError) throw createError(503, `미체결 주문 조회 실패: ${lookupError.message}`, lookupError);
  if (!pending) throw createError(404, "미체결 주문을 찾을 수 없습니다.");
  const asset = assets.get(pending.symbol);
  const priceFactor = asset?.unit === "USD" ? 1380 : 1;
  const databaseLimitPrice = limitPrice * priceFactor;
  const reservationAmount = quantity * databaseLimitPrice;
  const { data, error } = await getSupabaseAdmin().rpc("amend_pending_spot_order", {
    p_account_id: accountId, p_pending_order_id: pendingId, p_quantity: quantity,
    p_limit_price: databaseLimitPrice, p_reservation_amount: reservationAmount,
  });
  if (error) {
    if (error.code === "P0002") throw createError(404, error.message, error);
    if (error.code === "P0001" || error.code === "22023") throw createError(400, error.message, error);
    throw createError(503, `주문 정정 실패: ${error.message}`, error);
  }
  return { ...mapPendingOrder(data.pending_order), order: data.order || null };
};

export default { getAll, create, remove, amend };
