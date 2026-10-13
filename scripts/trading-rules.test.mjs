import test from "node:test";
import assert from "node:assert/strict";
import { getPriceStep, normalizeOrderPrice, stepOrderPrice, validateLimitPrice, validateOrderQuantity, calculateOrderAvailability, getDomesticMarketSession } from "../shared/tradingRules.js";
import { INITIAL_MARKETS } from "../src/data/markets.js";
import { estimateTradeTaxes } from "../src/utils/tradeTaxes.js";

const stock = INITIAL_MARKETS.stocks.find((asset) => asset.symbol === "005490");
const etf = INITIAL_MARKETS.stocks.find((asset) => asset.symbol === "069500");
const usd = INITIAL_MARKETS.stocks.find((asset) => asset.symbol === "AAPL");
const crypto = INITIAL_MARKETS.crypto[0];

test("국내 주식의 모든 호가구간과 경계의 위·아래 한 호가", () => {
  for (const market of ["KOSPI", "KOSDAQ"]) {
    const asset = { ...stock, market };
    for (const [boundary, previousStep, nextStep] of [[2000, 1, 5], [5000, 5, 10], [20000, 10, 50], [50000, 50, 100], [200000, 100, 500], [500000, 500, 1000]]) {
      assert.equal(getPriceStep(asset, boundary - previousStep), previousStep);
      assert.equal(getPriceStep(asset, boundary), nextStep);
      assert.equal(stepOrderPrice(asset, boundary, "down"), boundary - previousStep);
      assert.equal(stepOrderPrice(asset, boundary, "up"), boundary + nextStep);
      assert.equal(stepOrderPrice(asset, boundary - previousStep, 1), boundary);
    }
  }
});

test("정규화는 잘못된 호가를 방향에 맞춰 조정하고 올바른 호가는 보존한다", () => {
  assert.equal(normalizeOrderPrice(stock, 199999, "up"), 200000);
  assert.equal(normalizeOrderPrice(stock, 199999, "down"), 199900);
  assert.equal(normalizeOrderPrice(stock, 200250), 200500);
  assert.equal(stepOrderPrice(stock, 200250, "down"), 200000);
  assert.equal(stepOrderPrice(stock, 200250, "up"), 200500);
  assert.equal(stepOrderPrice(stock, 1, -1), 1);
  assert.equal(normalizeOrderPrice(stock, NaN), 0);
  assert.match(validateLimitPrice(stock, 334550), /500원/);
  assert.equal(validateLimitPrice(stock, 334500), "");
  for (const price of [0, -1, NaN, Infinity, "not-price", 1e20]) assert.notEqual(validateLimitPrice(stock, price), "");
});

test("ETF 2천원 경계, 달러 소수점, 채권 및 디지털자산 기준정보 식별", () => {
  assert.equal(getPriceStep(etf, 1999), 1);
  assert.equal(getPriceStep(etf, 2000), 5);
  assert.equal(getPriceStep(etf, 500000), 5);
  assert.equal(stepOrderPrice(etf, 2000, "down"), 1999);
  assert.equal(validateLimitPrice(etf, 112405), "");
  assert.equal(validateLimitPrice(usd, 231.70), "");
  assert.notEqual(validateLimitPrice(usd, 231.701), "");
  assert.equal(stepOrderPrice(usd, 0.29, "up"), 0.3);
  assert.equal(getPriceStep(INITIAL_MARKETS.bonds[0], 100000), 1);
  assert.equal(getPriceStep(crypto, 162500000), 1000);
  assert.equal(stepOrderPrice(crypto, 1000000, "down"), 999500);
  assert.equal(getPriceStep({ category: "crypto", unit: "KRW" }, 0.001), 0.00001);
});

test("미체결 매수 잔량과 거래별 반올림 수수료를 예약하고 취소·체결 주문은 제외", () => {
  const state = calculateOrderAvailability({
    cash: 1000000, assets: [stock], selected: stock, category: "domesticStocks", price: 100000,
    pendingOrders: [
      { symbol: stock.symbol, side: "BUY", quantity: 5, remainingQuantity: 2, limitPrice: 100000 },
      { symbol: stock.symbol, side: "BUY", quantity: 5, limitPrice: 100000, status: "CANCELLED" },
      { symbol: stock.symbol, side: "BUY", quantity: 5, limitPrice: 100000, status: "FILLED" },
      { symbol: stock.symbol, side: "BUY", quantity: 5, remainingQuantity: 0, limitPrice: 100000 },
    ],
  });
  assert.equal(state.reservedCash, 200030);
  assert.equal(state.availableCash, 799970);
  assert.equal(state.maxQuantity, 7);
});

test("모든 종목의 매수예약을 합산하고 해외주식 가격을 원화로 환산", () => {
  const state = calculateOrderAvailability({ cash: 1000000, selected: usd, category: "overseasStocks", price: 100,
    pendingOrders: [{ symbol: usd.symbol, side: "BUY", quantity: 2, limitPrice: 100 }, { symbol: stock.symbol, side: "BUY", quantity: 1, limitPrice: 100000 }],
  });
  assert.equal(state.reservedCash, 376208.2);
  assert.ok(Math.abs(state.availableCash - 623791.8) < 1e-8);
  assert.equal(state.maxQuantity, 4);
});

test("보유수량에서 같은 종목의 매도 잔량만 제외하고 초과 예약은 0으로 제한", () => {
  const input = { cash: 100, selected: stock, side: "SELL", positions: { [stock.id]: { quantity: 10 } }, pendingOrders: [
    { assetId: stock.id, side: "SELL", quantity: 8, remainingQuantity: 3 },
    { symbol: usd.symbol, side: "SELL", quantity: 20 },
    { symbol: stock.symbol, side: "SELL", quantity: 2, status: "CANCELLED" },
  ] };
  assert.deepEqual(calculateOrderAvailability(input), { reservedCash: 0, availableCash: 100, reservedSellQuantity: 3, availableSellQuantity: 7, maxQuantity: 7 });
  assert.equal(calculateOrderAvailability({ ...input, positions: {} }).availableSellQuantity, 0);
});

test("최대 매수량은 수수료를 포함해 현금을 넘지 않고 다음 수량은 초과한다", () => {
  for (const [asset, category, price, cash] of [[stock, "stocks", 1999, 10000], [usd, "stocks", 0.01, 1000], [crypto, "crypto", 162500000, 10000000]]) {
    const { maxQuantity } = calculateOrderAvailability({ selected: asset, category, price, cash });
    const step = category === "crypto" ? 0.00000001 : 1;
    const cost = (quantity) => -estimateTradeTaxes({ asset, category, side: "BUY", priceKrw: price * (asset.unit === "USD" ? 1380 : 1), quantity }).settlementAmount;
    assert.ok(cost(maxQuantity) <= cash + 1e-8);
    assert.ok(cost(maxQuantity + step) > cash);
  }
  assert.equal(calculateOrderAvailability({ selected: stock, price: 0, cash: 10000 }).maxQuantity, 0);
  assert.equal(calculateOrderAvailability({ selected: stock, price: 1000, cash: -1 }).availableCash, 0);
});

test("디지털자산의 매도가능수량은 DB와 동일한 8자리 잔량을 보존한다", () => {
  const result = calculateOrderAvailability({ selected: crypto, category: "crypto", side: "SELL", positions: { BTC: { quantity: 0.1234567 } }, pendingOrders: [{ symbol: "BTC", side: "SELL", quantity: 0.1 }] });
  assert.equal(result.maxQuantity, 0.0234567);
});

test("수량 검증은 정상 소수를 부동소수 오차로 거부하지 않고 8자리 미만 잔고를 매도한다", () => {
  for (const quantity of [1024.027027, 0.00000001, 0.12345678]) assert.equal(validateOrderQuantity("crypto", quantity), "");
  assert.notEqual(validateOrderQuantity("crypto", 0.000000001), "");
  assert.notEqual(validateOrderQuantity("stocks", 0.5), "");
  const result = calculateOrderAvailability({ selected: crypto, category: "crypto", side: "SELL", positions: { BTC: { quantity: 0.00000001 } } });
  assert.equal(result.maxQuantity, 0.00000001);
});

test("한국시간 기준 주말과 정규장 경계 안내, 공휴일 미반영 표시", () => {
  assert.equal(getDomesticMarketSession(new Date("2026-09-18T00:00:00Z")).isRegularSession, true);
  assert.equal(getDomesticMarketSession(new Date("2026-09-18T06:29:59Z")).isRegularSession, true);
  assert.equal(getDomesticMarketSession(new Date("2026-09-18T06:30:00Z")).isRegularSession, false);
  assert.equal(getDomesticMarketSession(new Date("2026-09-19T01:00:00Z")).label, "주말 휴장");
  assert.match(getDomesticMarketSession(new Date("2026-09-18T01:00:00Z")).description, /공휴일/);
  assert.equal(getDomesticMarketSession(new Date("invalid")).isRegularSession, false);
});
