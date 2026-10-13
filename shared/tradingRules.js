import { INITIAL_MARKETS } from "../src/data/markets.js";
import { estimateTradeTaxes } from "../src/utils/tradeTaxes.js";

// KRX 유가증권시장 업무규정 시행세칙 제32조, 코스닥시장 시행세칙 제18조.
// https://law.krx.co.kr/las/LawBon.jsp?lawid=000111
// 코스닥: https://regulation.krx.co.kr/contents/RGL/03/03020100/RGL03020100.jsp
// ETF: https://regulation.krx.co.kr/contents/RGL/03/03060101/RGL03060101.jsp
// 디지털자산 호가는 업비트 원화마켓의 2025-07-31 개정 표를 모의거래에 적용한다.
// https://docs.upbit.com/kr/docs/krw-market-info
export const TRADING_RULES_AS_OF = "2026-09-18";
export const SIMULATED_USD_KRW = 1380;

const catalog = new Map(Object.entries(INITIAL_MARKETS).flatMap(([category, assets]) =>
  assets.map((asset) => [asset.symbol, { ...asset, category }]),
));
const stockBands = [[2000, 1], [5000, 5], [20000, 10], [50000, 50], [200000, 100], [500000, 500], [Infinity, 1000]];
const cryptoBands = [[0.00001, 0.00000001], [0.0001, 0.0000001], [0.001, 0.000001], [0.01, 0.00001], [0.1, 0.0001], [1, 0.001], [10, 0.01], [100, 0.1], [5000, 1], [10000, 5], [50000, 10], [100000, 50], [500000, 100], [1000000, 500], [Infinity, 1000]];
const roundPrice = (value) => Number(value.toFixed(8));
const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const normalizeCategory = (category) => ["domesticStocks", "overseasStocks"].includes(category) ? "stocks" : category;
const assetCategory = (asset) => normalizeCategory(asset?.category || asset?.type || catalog.get(asset?.symbol || asset?.id)?.category)
  || (asset?.maturity ? "bonds" : "stocks");
const isDown = (direction) => direction === "down" || direction === "floor" || direction === -1;
const isUp = (direction) => direction === "up" || direction === "ceil" || direction === 1;

/** 가격은 종목 표시통화 기준이다. 미국주식·채권의 최소단위는 앱의 모의 정책이다. */
export function getPriceStep(asset, price = asset?.price) {
  const value = finitePositive(price);
  const category = assetCategory(asset);
  if (category === "crypto" && asset?.unit !== "USD") return cryptoBands.find(([ceiling]) => value < ceiling)[1];
  if (category === "bonds") return asset?.unit === "USD" ? 0.01 : 1;
  if (category === "futures") return 0.01;
  if (asset?.unit === "USD") return 0.01;
  if (asset?.group === "ETF" || asset?.group === "ETN") return value < 2000 ? 1 : 5;
  return stockBands.find(([ceiling]) => value < ceiling)[1];
}

/** 가장 가까운 유효 호가. down/up은 입력가격 이하/이상으로 맞춘다. */
export function normalizeOrderPrice(asset, price, direction = "nearest") {
  const value = finitePositive(price);
  if (!value) return 0;
  const step = getPriceStep(asset, value);
  const quotient = value / step;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4;
  const ticks = isDown(direction) ? Math.floor(quotient + tolerance)
    : isUp(direction) ? Math.ceil(quotient - tolerance) : Math.round(quotient);
  return roundPrice(Math.max(getPriceStep(asset, 0), ticks * step));
}

/** 경계가격에서 아래 호가는 이전 가격구간의 단위를 사용한다. */
export function stepOrderPrice(asset, price, direction = "up") {
  const value = finitePositive(price);
  if (!value) return getPriceStep(asset, 0);
  const down = isDown(direction);
  const aligned = normalizeOrderPrice(asset, value, down ? "down" : "up");
  if (Math.abs(aligned - value) > Number.EPSILON * Math.max(1, value) * 4) return aligned;
  const currentStep = getPriceStep(asset, aligned);
  const step = down ? getPriceStep(asset, aligned - currentStep / 2) : currentStep;
  return roundPrice(Math.max(getPriceStep(asset, 0), aligned + (down ? -step : step)));
}

/** 서버와 UI가 같은 지정가 검증을 사용한다. 빈 문자열이면 유효하다. */
export function validateLimitPrice(asset, price) {
  const value = finitePositive(price);
  if (!value || value > Number.MAX_SAFE_INTEGER) return "주문가격을 유효한 양수로 입력해 주세요.";
  const normalized = normalizeOrderPrice(asset, value);
  if (Math.abs(normalized - value) > Number.EPSILON * Math.max(1, value) * 4) {
    const step = getPriceStep(asset, value).toLocaleString("ko-KR", { maximumFractionDigits: 8 });
    return `이 가격대는 ${step}${asset?.unit === "USD" ? "달러" : asset?.unit === "PTS" ? "포인트" : "원"} 호가단위로 주문해 주세요.`;
  }
  return "";
}

export function validateOrderQuantity(category, value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) return "주문수량을 유효한 양수로 입력해 주세요.";
  if (category !== "crypto" && !Number.isSafeInteger(quantity)) return "주식·채권·선물 수량은 정수로 입력해 주세요.";
  if (category === "crypto" && Math.abs(quantity - Number(quantity.toFixed(8))) > Number.EPSILON * quantity) return "디지털자산 수량은 소수점 8자리까지 입력합니다.";
  return "";
}

const openOrder = (order) => !["FILLED", "CANCELLED", "CANCELED", "REJECTED", "EXPIRED"].includes(String(order.status || "").toUpperCase());
const remainingQuantity = (order) => finitePositive(order.remainingQuantity ?? order.quantity);
const sameAsset = (left, right) => Boolean(left && right && (
  (left.symbol && left.symbol === right.symbol)
  || (left.assetId && left.assetId === (right.id || right.symbol))
  || (left.id && left.id === right.id)
));

/**
 * 현금은 원화, price/limitPrice는 종목 표시통화. 미체결 잔량만 예약한다.
 * 현물 매도가능수량에는 대주·신용 신규한도를 포함하지 않는다.
 * usdKrw는 기본 모의 환율을 대체할 때만 지정한다.
 */
export function calculateOrderAvailability({ cash = 0, pendingOrders = [], assets = [], positions = {}, selected, category, side = "BUY", price = selected?.price, usdKrw = SIMULATED_USD_KRW } = {}) {
  const assetList = Array.isArray(assets) ? assets : Object.values(assets).flat();
  const lookup = new Map(catalog);
  for (const asset of assetList) lookup.set(asset.symbol || asset.id, asset);
  if (selected) lookup.set(selected.symbol || selected.id, selected);
  const rate = finitePositive(usdKrw) || SIMULATED_USD_KRW;
  const priceKrw = (asset, value) => finitePositive(value) * (asset?.unit === "USD" ? rate : 1);
  const buyCost = (asset, value, quantity, tradeCategory) => -estimateTradeTaxes({
    category: normalizeCategory(tradeCategory) || assetCategory(asset), asset, side: "BUY", priceKrw: priceKrw(asset, value), quantity,
  }).settlementAmount;
  const activeOrders = pendingOrders.filter(openOrder);
  const reservedCash = activeOrders.filter((order) => order.side === "BUY").reduce((sum, order) => {
    const asset = lookup.get(order.symbol || order.assetId) || order;
    return sum + buyCost(asset, order.limitPrice ?? order.requestedPrice ?? asset.price, remainingQuantity(order), order.category);
  }, 0);
  const availableCash = Math.max(0, finitePositive(cash) - reservedCash);
  const reservedSellQuantity = activeOrders.filter((order) => order.side === "SELL" && sameAsset(order, selected))
    .reduce((sum, order) => sum + remainingQuantity(order), 0);
  const owned = Array.isArray(positions)
    ? positions.filter((position) => sameAsset(position, selected)).reduce((sum, position) => sum + finitePositive(position.quantity), 0)
    : finitePositive(positions[selected?.id]?.quantity ?? positions[selected?.symbol]?.quantity);
  const availableSellQuantity = Math.max(0, roundPrice(owned - reservedSellQuantity));
  const tradeCategory = normalizeCategory(category) || assetCategory(selected);
  const precision = tradeCategory === "crypto" ? 100000000 : 1;
  let maxQuantity = 0;
  if (side === "SELL") {
    maxQuantity = Math.floor(availableSellQuantity * precision + 1e-8) / precision;
  } else if (selected && finitePositive(price)) {
    // 수수료를 거래금액 전체에서 반올림하므로 1주 수수료를 곱하지 않는다.
    let low = 0;
    let high = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(availableCash / priceKrw(selected, price) * precision));
    while (low < high) {
      const mid = low + Math.ceil((high - low) / 2);
      if (buyCost(selected, price, mid / precision, tradeCategory) <= availableCash + 1e-8) low = mid;
      else high = mid - 1;
    }
    maxQuantity = low / precision;
  }
  return { reservedCash, availableCash, reservedSellQuantity, availableSellQuantity, maxQuantity };
}

/**
 * 한국시간의 일반 거래시간 안내이며 거래 가능 여부를 판정하는 휴장일 캘린더가 아니다.
 * https://regulation.krx.co.kr/contents/RGL/03/03010100/RGL03010100T1.jsp
 */
export function getDomesticMarketSession(date = new Date()) {
  const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(timestamp)) return { label: "시간 확인 필요", isRegularSession: false, description: "거래시간을 확인할 수 없습니다." };
  const koreanTime = new Date(timestamp + 9 * 60 * 60 * 1000);
  const day = koreanTime.getUTCDay();
  const minutes = koreanTime.getUTCHours() * 60 + koreanTime.getUTCMinutes();
  if (day === 0 || day === 6) return { label: "주말 휴장", isRegularSession: false, description: "KRX 정규장은 월~금 09:00~15:30에 운영됩니다." };
  const note = "한국시간 기준 안내이며 공휴일·임시 휴장·거래시간 변경은 반영하지 않습니다.";
  if (minutes >= 540 && minutes < 930) return { label: "정규장 시간대", isRegularSession: true, description: `KRX 정규장 09:00~15:30. ${note}` };
  if (minutes >= 510 && minutes < 540) return { label: "장 시작 전", isRegularSession: false, description: `KRX 정규장 호가접수 08:30~09:00. ${note}` };
  return { label: "정규장 외 시간", isRegularSession: false, description: `KRX 정규장 09:00~15:30. ${note}` };
}
