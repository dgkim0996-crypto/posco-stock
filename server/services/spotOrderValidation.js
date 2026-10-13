import { INITIAL_MARKETS } from "../../src/data/markets.js";
import { validateLimitPrice } from "../../shared/tradingRules.js";

export const spotAssets = new Map(Object.entries(INITIAL_MARKETS)
  .filter(([category]) => category !== "futures")
  .flatMap(([category, assets]) => assets.map((asset) => [asset.symbol, { ...asset, category }])));
export const orderError = (status, message, cause) => Object.assign(new Error(message), { status, cause });
export const priceFactorFor = (asset) => asset?.unit === "USD" ? 1380 : 1;
// DB 가격 컬럼(numeric(30,8))과 같은 자릿수로 고정한다. 345.60*1380=476928.00000000006처럼
// 미반올림 값을 넘기면 저장된 지정가와 체결가 비교가 어긋나 교차한 주문이 체결되지 않는다.
const dbPrice = (value) => Number(value.toFixed(8));
export const toKrwPrice = (asset, price) => dbPrice(Number(price) * priceFactorFor(asset));
export const fromKrwPrice = (asset, price) => dbPrice(Number(price) / priceFactorFor(asset));
const numericValue = (value) => typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;

export function accountIdOf(value) {
  const id = numericValue(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw orderError(400, "잘못된 계좌 ID 형식입니다.");
  return id;
}

export function pendingIdOf(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw orderError(400, "미체결 주문 ID가 올바르지 않습니다.");
  }
  return value;
}

export function quantityOf(value, asset) {
  const quantity = numericValue(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) {
    throw orderError(400, "주문수량은 0보다 큰 유효한 숫자여야 합니다.");
  }
  if (asset.category !== "crypto" && !Number.isSafeInteger(quantity)) {
    throw orderError(400, "주식과 채권 주문수량은 정수여야 합니다.");
  }
  if (asset.category === "crypto" && Math.abs(quantity - Number(quantity.toFixed(8))) > Number.EPSILON * quantity) {
    throw orderError(400, "가상자산 주문수량은 소수점 8자리까지 입력할 수 있습니다.");
  }
  return quantity;
}

export function limitPriceOf(value, asset) {
  const price = numericValue(value);
  if (!Number.isFinite(price) || price <= 0 || price > Number.MAX_SAFE_INTEGER) throw orderError(400, "지정가가 올바르지 않습니다.");
  const error = validateLimitPrice(asset, price);
  if (error) throw orderError(400, error);
  return price;
}

export function validateSpotOrder(payload) {
  const accountId = accountIdOf(payload.accountId);
  const symbol = typeof payload.symbol === "string" ? payload.symbol.trim() : "";
  const asset = spotAssets.get(symbol);
  if (!asset) throw orderError(400, "지원하지 않는 현물 종목입니다.");
  if (!["BUY", "SELL"].includes(payload.side)) throw orderError(400, "side는 BUY 또는 SELL이어야 합니다.");
  const orderType = payload.orderType ?? "MARKET";
  if (!["MARKET", "LIMIT"].includes(orderType)) throw orderError(400, "orderType은 MARKET 또는 LIMIT이어야 합니다.");
  const quantity = quantityOf(payload.quantity, asset);
  const requestedPrice = orderType === "LIMIT" ? limitPriceOf(payload.requestedPrice, asset) : null;
  const pendingOrderId = payload.pendingOrderId == null ? null : pendingIdOf(payload.pendingOrderId);
  const fillQuantity = payload.fillQuantity == null ? null : quantityOf(payload.fillQuantity, asset);
  if (fillQuantity != null && (!pendingOrderId || fillQuantity > quantity)) {
    throw orderError(400, "부분체결 수량은 미체결 주문의 잔여수량 이하여야 합니다.");
  }
  return { accountId, symbol, asset, side: payload.side, orderType, quantity, requestedPrice, pendingOrderId, fillQuantity };
}

// 체결 요청의 종목/방향/가격은 클라이언트가 아닌 저장된 주문으로 결정한다.
export function bindPendingOrder(payload, pending) {
  if (!pending) throw orderError(404, "미체결 주문을 찾을 수 없습니다.");
  if ((payload.symbol != null && payload.symbol !== pending.symbol)
    || (payload.side != null && payload.side !== pending.side)) {
    throw orderError(409, "체결 요청이 저장된 미체결 주문과 일치하지 않습니다.");
  }
  const asset = spotAssets.get(pending.symbol);
  if (!asset) throw orderError(400, "지원하지 않는 현물 종목입니다.");
  return validateSpotOrder({
    ...payload, symbol: pending.symbol, side: pending.side, orderType: "LIMIT",
    quantity: Number(pending.quantity), requestedPrice: fromKrwPrice(asset, pending.limit_price),
  });
}

export function quoteIsFresh(quote, maxAgeMs = 120_000, now = Date.now()) {
  const timestamp = Date.parse(quote?.updatedAt);
  return Number.isFinite(quote?.price) && quote.price > 0 && quote.isReal === true
    && Number.isFinite(timestamp) && timestamp <= now + 60_000 && now - timestamp <= maxAgeMs;
}

export function assertLimitCrossed(input, executionPrice) {
  if (input.orderType !== "LIMIT") return;
  const limit = toKrwPrice(input.asset, input.requestedPrice);
  const price = dbPrice(Number(executionPrice));
  if (input.side === "BUY" ? price > limit : price < limit) {
    throw orderError(409, "아직 지정가 체결 조건에 도달하지 않았습니다.");
  }
}

export const roundMoney = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;
export const buyReservation = (quantity, price, feeRate) => {
  const gross = roundMoney(quantity * price);
  return roundMoney(gross + roundMoney(gross * feeRate));
};
