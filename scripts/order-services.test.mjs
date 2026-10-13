import test from "node:test";
import assert from "node:assert/strict";
process.env.SUPABASE_ENABLED = "false";
const { default: orders, executionQuoteFor } = await import("../server/services/orders.service.js");
const { default: pending } = await import("../server/services/pendingOrders.service.js");
const { createPendingMatcher, simulatedFillQuantity } = await import("../server/services/pendingOrderMatcher.service.js");
const { validateSpotOrder, bindPendingOrder, quoteIsFresh } = await import("../server/services/spotOrderValidation.js");
const key = "11111111-1111-4111-8111-111111111111";
const payload = { accountId: 1, symbol: "005490", side: "BUY", quantity: 2, clientOrderId: key };
const stored = { account: { id: 1, krw_balance: 900, usd_balance: 0 }, order: { id: "order", symbol: "005490", quantity: 2, filled_quantity: 2, execution_price: 1000, status: "FILLED", fee_amount: .3 }, holding: { symbol: "005490", quantity: 2, avg_price: 1000 }, pending_order: { id: key, order_id: "order", symbol: "005490", quantity: 2, limit_price: 1000, reserved_amount: 2000.3 } };

test("market acceptance uses atomic once RPC; replay bypasses changed quote and depleted capacity", async () => {
  const calls = [];
  let cached = null;
  const database = { rpc: async (name, args) => { calls.push([name, args]); return { data: name === "get_order_request" ? cached : stored }; } };
  const first = await orders.createOrder(payload, { database, quoteFor: async () => ({ price: 1000 }), capacity: async () => ({}) });
  assert.equal(first.account.krwBalance, 900);
  assert.equal(calls[1][0], "place_spot_order_once");
  assert.equal(calls[1][1].p_client_order_id, key);
  cached = stored;
  const replay = await orders.createOrder(payload, { database, quoteFor: () => assert.fail("must not refetch"), capacity: () => assert.fail("must not recalculate") });
  assert.equal(replay.order.id, first.order.id);
  assert.equal(replay.replayed, true);
  assert.equal(calls.length, 3);
});

test("limit acceptance uses once RPC with KRW identity and returns saved replay", async () => {
  const calls = [];
  let cached = null;
  const database = { rpc: async (name, args) => { calls.push([name, args]); return { data: name === "get_order_request" ? cached : stored }; } };
  const request = { symbol: "AAPL", side: "BUY", quantity: 2, limitPrice: 100, clientOrderId: key };
  await pending.create(1, request, { database, capacity: async () => ({ reservedAmount: 276193.2 }) });
  assert.equal(calls[0][1].p_request.price, 138000);
  assert.equal(calls[1][0], "create_pending_spot_order_once");
  assert.equal(calls[1][1].p_limit_price, 138000);
  cached = stored;
  const result = await pending.create(1, request, { database, capacity: () => assert.fail("must not reserve again") });
  assert.equal(result.replayed, true);
  assert.equal(calls.length, 3);
});

test("latest quote is required and stored pending identity cannot be forged", async () => {
  const input = validateSpotOrder(payload);
  assert.equal(quoteIsFresh({ price: 1000, isReal: true, updatedAt: new Date(Date.now() - 180000).toISOString() }), false);
  await assert.rejects(executionQuoteFor(input, { getQuote: () => null, fetchQuote: async () => null }), /시세/);
  assert.throws(() => bindPendingOrder({ ...payload, symbol: "005930", pendingOrderId: key }, { symbol: "005490", side: "BUY", quantity: 2, limit_price: 1000 }), /일치/);
  assert.throws(() => validateSpotOrder({ ...payload, quantity: 1.5 }), /정수/);
  assert.throws(() => validateSpotOrder({ ...payload, orderType: "LIMIT", requestedPrice: 334550 }), /호가/);
});

test("server matcher works without browser, bounds batches, throttles and skips uncrossed quotes", async () => {
  let clock = 10000;
  const rows = [{ id: key, account_id: 1, symbol: "005490", category: "stocks", side: "BUY", quantity: 5, limit_price: 1000 }];
  const calls = [];
  let price = 900;
  const builder = { select() { return this; }, order() { return this; }, limit(n) { assert.equal(n, 20); return this; }, eq() { return this; }, gt() { return this; }, then(resolve) { return Promise.resolve({ data: rows }).then(resolve); } };
  const database = { from: () => builder, rpc: async (name, args) => { calls.push([name, args]); return { data: { matched: true } }; } };
  const matcher = createPendingMatcher({ database: () => database, now: () => clock, quoteFor: async () => ({ price, updatedAt: new Date().toISOString() }) });
  const result = await matcher.runForAccount(1);
  assert.equal(result.matched, 1);
  assert.equal(calls[0][0], "match_pending_spot_order");
  assert.equal(calls[0][1].p_fill_quantity, 2);
  assert.equal((await matcher.runForAccount(1)).throttled, true);
  assert.equal(calls.length, 1);
  clock += 5000; price = 1100;
  assert.equal((await matcher.runForAccount(1)).deferred, 1);
  assert.equal(calls.length, 1);
  assert.equal(simulatedFillQuantity(.00000001, "crypto"), .00000001);
});

test("synthetic product derives server-side price from fresh underlying quotes only", async () => {
  const input = validateSpotOrder({ ...payload, symbol: "SH10X" });
  const at = new Date().toISOString();
  const market = { getQuote: (symbol) => ({ price: 100000, change: symbol === "005930" ? 1 : 3, isReal: true, updatedAt: at }) };
  const quote = await executionQuoteFor(input, market, undefined, { refresh: false });
  assert.equal(quote.price, 12000);
  assert.equal(quote.isSimulation, true);
  await assert.rejects(executionQuoteFor(input, { getQuote: () => null }, undefined, { refresh: false }), /시세/);
});

const { assertOrderCapacity, defaultChargePolicyCode, getFeeRate } = await import("../server/services/orderCapacity.service.js");
const { assertLimitCrossed, spotAssets, toKrwPrice } = await import("../server/services/spotOrderValidation.js");
const { feeRateForTrade } = await import("../src/utils/tradeTaxes.js");
const freshQuote = (price) => ({ getQuote: () => ({ price, isReal: true, updatedAt: new Date().toISOString() }) });
// Supabase 체인 호출을 테이블별 결과 함수로 흉내낸다. eq 조건은 결과 함수에 전달된다.
const fakeDatabase = (tables, calls = []) => ({
  from(table) {
    const filters = {};
    const result = () => Promise.resolve(tables[table](filters));
    const builder = {
      select: () => builder, order: () => builder, limit: () => builder, gt: () => builder,
      eq(column, value) { filters[column] = value; return builder; },
      maybeSingle: result, single: result, then: (resolve, reject) => result().then(resolve, reject),
    };
    return builder;
  },
  rpc: async (name, args) => { calls.push([name, args]); return tables[`rpc:${name}`]?.(args) ?? { data: stored }; },
});

test("USD limit/market prices are converted once to the DB's 8-digit KRW price", async () => {
  const aapl = spotAssets.get("AAPL");
  assert.notEqual(345.6 * 1380, 476928, "precondition: raw float multiplication is not the stored price");
  assert.equal(toKrwPrice(aapl, 345.6), 476928);
  const calls = [];
  const limitDatabase = { rpc: async (name, args) => { calls.push([name, args]); return { data: name === "get_order_request" ? null : stored }; } };
  await pending.create(1, { symbol: "AAPL", side: "BUY", quantity: 2, limitPrice: 345.6, clientOrderId: key }, { database: limitDatabase, capacity: async ({ price }) => { assert.equal(price, 476928); return { reservedAmount: 1 }; } });
  assert.equal(calls[0][1].p_request.price, 476928);
  assert.equal(calls[1][1].p_limit_price, 476928);

  const input = validateSpotOrder({ ...payload, symbol: "AAPL", orderType: "LIMIT", requestedPrice: 345.6 });
  assert.equal((await executionQuoteFor(input, freshQuote(345.6), undefined, { refresh: false })).price, 476928);
  const marketCalls = [];
  const database = { rpc: async (name, args) => { marketCalls.push([name, args]); return { data: name === "get_order_request" ? null : stored }; } };
  await orders.createOrder({ ...payload, symbol: "AAPL", orderType: "LIMIT", requestedPrice: 345.6 }, { database, quoteFor: (value) => executionQuoteFor(value, freshQuote(345.6), undefined, { refresh: false }), capacity: async () => ({}) });
  assert.equal(marketCalls[1][1].p_execution_price, 476928);
  assert.equal(marketCalls[1][1].p_requested_price, 476928);

  // 345.67*1380을 저장 후 달러로 나눴다 다시 곱하면 477024.5999999999가 되어 같은 가격의 매수가 미교차로 판정됐다.
  const boundOrder = bindPendingOrder({ accountId: 1, pendingOrderId: key }, { symbol: "AAPL", side: "BUY", quantity: 1, limit_price: "477024.60000000" });
  assert.doesNotThrow(() => assertLimitCrossed(boundOrder, 477024.6));
  assert.doesNotThrow(() => assertLimitCrossed({ ...boundOrder, side: "SELL" }, 477024.6));
  assert.throws(() => assertLimitCrossed(boundOrder, 477024.61), /지정가/);
});

test("server matcher sends the same rounded USD price the pending order stored", async () => {
  const rows = [{ id: key, account_id: 1, symbol: "AAPL", category: "stocks", side: "BUY", quantity: 2, limit_price: "476928.00000000" }];
  const calls = [];
  const database = fakeDatabase({ pending_orders: () => ({ data: rows }), "rpc:match_pending_spot_order": () => ({ data: { matched: true } }) }, calls);
  const matcher = createPendingMatcher({ database: () => database, quoteFor: (input) => executionQuoteFor(input, freshQuote(345.6), undefined, { refresh: false }) });
  assert.equal((await matcher.runForAccount(1)).matched, 1);
  assert.equal(calls[0][1].p_execution_price, 476928);
  assert.equal(calls[0][1].p_observed_limit_price, 476928);
});

test("amendment sends the remaining quantity the user saw and rejects a fill that happened meanwhile", async () => {
  const row = { symbol: "AAPL", category: "stocks", side: "BUY", quantity: 3 };
  const calls = [];
  const tables = { pending_orders: () => ({ data: row }), "rpc:amend_pending_spot_order": () => ({ data: { pending_order: { ...stored.pending_order, symbol: "AAPL", limit_price: 476928, quantity: 3 } } }) };
  const capacity = async ({ price }) => { assert.equal(price, 476928); return { reservedAmount: 1 }; };
  const amended = await pending.amend(1, key, { quantity: 3, limitPrice: 345.6, expectedRemaining: 3 }, { database: fakeDatabase(tables, calls), capacity });
  assert.equal(calls[0][1].p_expected_remaining, 3);
  assert.equal(calls[0][1].p_limit_price, 476928);
  assert.equal(amended.limitPrice, 345.6);

  await assert.rejects(pending.amend(1, key, { quantity: 5, limitPrice: 345.6, expectedRemaining: 5 }, { database: fakeDatabase(tables, calls), capacity: () => assert.fail("stale amendment must stop before capacity") }), (error) => error.status === 409);
  assert.equal(calls.length, 1, "stale amendment must not reach the RPC");

  await pending.amend(1, key, { quantity: 2, limitPrice: 345.6 }, { database: fakeDatabase(tables, calls), capacity });
  assert.equal(calls[1][1].p_expected_remaining, 3, "older clients fall back to the quantity just read");

  tables["rpc:amend_pending_spot_order"] = () => ({ error: { code: "P4090", message: "잔여수량이 바뀌었습니다." } });
  await assert.rejects(pending.amend(1, key, { quantity: 3, limitPrice: 345.6, expectedRemaining: 3 }, { database: fakeDatabase(tables, calls), capacity }), (error) => error.status === 409 && /잔여수량/.test(error.message));
});

test("SH10X fee policy matches the screen's domestic ETF rate instead of the overseas default", async () => {
  const sh10x = spotAssets.get("SH10X");
  const aapl = spotAssets.get("AAPL");
  const rates = { KR_STOCK: 0.00015, KR_ETF: 0.00015, US_STOCK: 0.0007, OTHER: 0.00015 };
  const database = fakeDatabase({
    trade_charge_overrides: () => ({ data: null }),
    trade_charge_policies: ({ code }) => ({ data: { fee_rate: String(rates[code]) } }),
  });
  assert.equal(defaultChargePolicyCode(sh10x), "KR_ETF");
  assert.equal(defaultChargePolicyCode(aapl), "US_STOCK");
  assert.equal(defaultChargePolicyCode(spotAssets.get("005490")), "KR_STOCK");
  assert.equal(await getFeeRate(sh10x, database), feeRateForTrade("stocks", sh10x));
  assert.equal(await getFeeRate(aapl, database), feeRateForTrade("stocks", aapl));
});

test("digital-asset sell capacity sums pending quantities in 1e-8 units", async () => {
  const btc = spotAssets.get("BTC");
  const database = (pendingRows, held) => fakeDatabase({
    accounts: () => ({ data: { krw_balance: 0 } }),
    pending_orders: () => ({ data: pendingRows }),
    trade_charge_overrides: () => ({ data: null }),
    trade_charge_policies: () => ({ data: { fee_rate: 0.00015 } }),
    holdings: () => ({ data: [{ symbol: "BTC", quantity: held }] }),
    finance_contracts: () => ({ data: null }),
    short_positions: () => ({ data: [] }),
  });
  const pendingSell = [{ id: "p1", symbol: "BTC", category: "crypto", side: "SELL", quantity: 0.1, limit_price: 162500000, reserved_amount: 0 }];
  assert.ok(0.1 + 0.2 > 0.3, "precondition: the float sum exceeds the holding");
  await assertOrderCapacity({ accountId: 1, asset: btc, side: "SELL", quantity: 0.2, price: 162500000 }, database(pendingSell, 0.3));
  await assert.rejects(assertOrderCapacity({ accountId: 1, asset: btc, side: "SELL", quantity: 0.20000001, price: 162500000 }, database(pendingSell, 0.3)), /매도가능수량/);
});

test("REST quote time does not advance while price and cumulative volume are unchanged", async () => {
  const { default: market } = await import("../server/services/marketData.service.js");
  const { default: kisAuth } = await import("../server/services/kisAuth.service.js");
  const { default: kisRequest } = await import("../server/services/kisRequest.service.js");
  const { default: marketDatabase } = await import("../server/services/marketDatabase.service.js");
  const originals = { token: kisAuth.getAccessToken, base: kisAuth.getBaseUrl, fetch: kisRequest.fetchWithLimit, save: marketDatabase.saveQuote };
  let output = { stck_prpr: "222222", acml_vol: "9" };
  kisAuth.getAccessToken = async () => "token";
  kisAuth.getBaseUrl = () => "https://kis.invalid";
  kisRequest.fetchWithLimit = async () => ({ ok: true, status: 200, json: async () => ({ rt_cd: "0", output }) });
  marketDatabase.saveQuote = () => {};
  try {
    // 마지막 체결을 10분 전에 받았고 장 마감 후 폴링은 같은 종가·누적거래량만 돌려준다.
    const closedAt = new Date(Date.now() - 600_000).toISOString();
    market.ingestRealtimeQuote({ symbol: "005490", price: 222222, volume: 9, updatedAt: closedAt });
    assert.equal((await market.fetchQuote("005490")).updatedAt, closedAt);
    assert.equal((await market.fetchQuote("005490")).updatedAt, closedAt);
    assert.equal(quoteIsFresh(market.getQuote("005490")), false);
    await assert.rejects(executionQuoteFor(validateSpotOrder(payload), market), /시세/, "a closed-market price must not fill again");
    output = { stck_prpr: "222222", acml_vol: "10" };
    const traded = await market.fetchQuote("005490");
    assert.notEqual(traded.updatedAt, closedAt, "a new trade at the same price is a new quote");
    assert.equal(quoteIsFresh(traded), true);
    output = { stck_prpr: "222300", acml_vol: "10" };
    assert.equal(quoteIsFresh(await market.fetchQuote("005490")), true);
  } finally {
    Object.assign(kisAuth, { getAccessToken: originals.token, getBaseUrl: originals.base });
    kisRequest.fetchWithLimit = originals.fetch;
    marketDatabase.saveQuote = originals.save;
  }
});
