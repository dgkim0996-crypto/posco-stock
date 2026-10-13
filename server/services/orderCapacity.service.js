import { getSupabaseAdmin } from "../lib/supabase.js";
import { buyReservation, orderError } from "./spotOrderValidation.js";

// trade_charge_overrides가 없을 때의 기본 정책. 6자리 코드가 아닌 원화 ETF(합성 SH10X)는
// 화면 요율(tradeTaxes.js)과 023 override처럼 국내 ETF로 본다. 해외주식으로 보면 0.07%가 예약된다.
export const defaultChargePolicyCode = (asset) => asset.category !== "stocks" ? "OTHER"
  : /^\d{6}$/.test(asset.symbol) ? "KR_STOCK" : asset.unit === "KRW" ? "KR_ETF" : "US_STOCK";

export async function getFeeRate(asset, database = getSupabaseAdmin()) {
  const { data: override, error: overrideError } = await database.from("trade_charge_overrides")
    .select("policy_code").eq("symbol", asset.symbol).maybeSingle();
  if (overrideError) throw orderError(503, "주문 수수료 정책을 조회하지 못했습니다.", overrideError);
  const policyCode = override?.policy_code || defaultChargePolicyCode(asset);
  const { data, error } = await database.from("trade_charge_policies").select("fee_rate").eq("code", policyCode).single();
  if (error) throw orderError(503, "주문 수수료 정책을 조회하지 못했습니다.", error);
  return Number(data.fee_rate);
}

// 디지털자산 수량은 DB와 같은 1e-8 단위 정수로 합산한다. 0.1+0.2>0.3 같은 오차로 보유분 전량 매도가 막히지 않게 한다.
const quantityScale = (category) => category === "crypto" ? 100_000_000 : 1;

// API 선검사는 기존 DB에도 적용한다. 동시 주문의 최종 보장은 020의 계좌 행 잠금이 담당한다.
export async function assertOrderCapacity({ accountId, asset, side, quantity, price, pendingOrderId = null, remainingQuantity = 0, remainingPrice = price }, database = getSupabaseAdmin()) {
  const [account, pending, feeRate] = await Promise.all([
    database.from("accounts").select("krw_balance").eq("id", accountId).maybeSingle(),
    database.from("pending_orders").select("id,symbol,category,side,quantity,limit_price,reserved_amount").eq("account_id", accountId),
    getFeeRate(asset, database),
  ]);
  if (account.error || pending.error) throw orderError(503, "주문가능 잔고를 조회하지 못했습니다.", account.error || pending.error);
  if (!account.data) throw orderError(404, "계좌를 찾을 수 없습니다.");
  const other = pending.data.filter((row) => row.id !== pendingOrderId);
  if (side === "BUY") {
    const reserved = other.filter((row) => row.side === "BUY").reduce((sum, row) => sum + Number(row.reserved_amount), 0);
    const required = buyReservation(quantity, price, feeRate) + buyReservation(remainingQuantity, remainingPrice, feeRate);
    if (required + reserved > Number(account.data.krw_balance) + 0.000001) {
      throw orderError(400, "수수료와 미체결 매수 예약금을 포함한 주문가능금액이 부족합니다.");
    }
    return { feeRate, reservedAmount: required };
  }
  const [holdings, finance, shorts] = await Promise.all([
    database.from("holdings").select("symbol,quantity").eq("account_id", accountId),
    database.from("finance_contracts").select("active,limit_amount").eq("account_id", accountId).eq("product_type", "lending").maybeSingle(),
    database.from("short_positions").select("quantity,avg_price").eq("account_id", accountId),
  ]);
  const failed = [holdings, finance, shorts].find((result) => result.error);
  if (failed) throw orderError(503, "매도가능수량을 조회하지 못했습니다.", failed.error);
  const owned = new Map(holdings.data.map((row) => [row.symbol, Number(row.quantity)]));
  const sells = other.filter((row) => row.side === "SELL")
    .map((row) => ({ symbol: row.symbol, category: row.category, quantity: Number(row.quantity), price: Number(row.limit_price) }));
  sells.push({ symbol: asset.symbol, category: asset.category, quantity: quantity + remainingQuantity, price: Math.max(price, remainingPrice) });
  const exposures = new Map();
  for (const sell of sells) {
    const exposure = exposures.get(sell.symbol) || { units: 0, price: 0, category: sell.category };
    exposure.units += Math.round(sell.quantity * quantityScale(sell.category));
    exposure.price = Math.max(exposure.price, sell.price);
    exposures.set(sell.symbol, exposure);
  }
  let reservedBorrowing = 0;
  for (const [symbol, exposure] of exposures) {
    const scale = quantityScale(exposure.category);
    const borrowed = Math.max(0, exposure.units - Math.round((owned.get(symbol) || 0) * scale)) / scale;
    if (borrowed > 0 && exposure.category !== "stocks") throw orderError(400, "미체결 매도수량을 제외한 매도가능수량이 부족합니다.");
    reservedBorrowing += borrowed * exposure.price;
  }
  if (reservedBorrowing > 0) {
    if (!finance.data?.active) throw orderError(400, "미체결 매도수량을 제외한 매도가능수량이 부족합니다.");
    const used = shorts.data.reduce((sum, row) => sum + Number(row.quantity) * Number(row.avg_price), 0);
    if (used + reservedBorrowing > Number(finance.data.limit_amount)) throw orderError(400, "미체결 매도수량을 포함한 대주한도를 초과했습니다.");
  }
  return { feeRate, reservedAmount: 0 };
}
