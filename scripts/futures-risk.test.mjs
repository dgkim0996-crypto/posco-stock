import test from "node:test";
import assert from "node:assert/strict";
process.env.SUPABASE_ENABLED = "false";
const { INITIAL_MARKETS } = await import("../src/data/markets.js");
const { SIMULATED_USD_KRW } = await import("../shared/tradingRules.js");
const { createAlternativeMarketData, futuresQuoteState, FUTURES_FETCH_MAX_AGE_MS, FUTURES_MARKET_MAX_AGE_MS } = await import("../server/services/alternativeMarketData.service.js");
const { default: futures, futuresKrwMultiplier } = await import("../server/services/futures.service.js");
const { default: risk, assessAccountRisk, planLiquidation, evaluateFuturesPosition, createRiskMonitor } = await import("../server/services/risk.service.js");
const { futuresPositionPnl } = await import("../src/features/account/usePortfolio.js");

const NOW = Date.parse("2026-10-13T01:00:00Z");
const iso = (offsetMs = 0) => new Date(NOW + offsetMs).toISOString();
const freshQuote = (symbol, price, overrides = {}) => ({ symbol, price, fetchedAt: iso(-5_000), priceUpdatedAt: iso(-10 * 60_000), ...overrides });
const quoteSource = (...items) => ({ loadQuotes: async () => ({ items: { futures: items } }), getCachedQuotes: () => null });

/** supabase-js 질의 체인 중 위험엔진이 쓰는 부분만 메모리 표로 흉내낸다. */
function fakeDatabase(tables, rpc = async () => ({ data: null, error: null })) {
  const calls = [];
  const from = (table) => {
    let rows = [...(tables[table] || [])];
    const builder = {
      select: () => builder,
      eq: (column, value) => { rows = rows.filter((row) => row[column] === value); return builder; },
      gt: (column, value) => { rows = rows.filter((row) => row[column] > value); return builder; },
      order: (column, { ascending = true } = {}) => { rows.sort((a, b) => (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1)); return builder; },
      limit: (count) => { rows = rows.slice(0, count); return builder; },
      single: async () => ({ data: rows[0], error: rows[0] ? null : { message: "not found" } }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return builder;
  };
  return { from, calls, rpc: async (name, args) => { calls.push([name, args]); return rpc(name, args, tables); } };
}

test("USD futures settle in KRW: catalog and server multiplier both apply the simulated FX rate", () => {
  for (const asset of INITIAL_MARKETS.futures) {
    assert.ok(["KRW", "USD"].includes(asset.currency), `${asset.symbol} currency`);
    assert.equal(futuresKrwMultiplier(asset), asset.multiplier, `${asset.symbol} catalog multiplier must be KRW per point`);
    if (asset.currency === "USD") assert.equal(asset.multiplier, asset.contractMultiplier * SIMULATED_USD_KRW);
  }
  const usd = Object.fromEntries(INITIAL_MARKETS.futures.filter((asset) => asset.currency === "USD").map((asset) => [asset.symbol, asset.contractMultiplier]));
  assert.deepEqual(usd, { NQ: 20, ES: 50, YM: 5, NKD: 5, CL: 1000, GC: 100, SI: 5000, NG: 10000, HG: 25000 });
  assert.equal(INITIAL_MARKETS.futures.find((asset) => asset.symbol === "K200").multiplier, 250000);
  assert.match(INITIAL_MARKETS.futures.find((asset) => asset.symbol === "KQ150").name, /KOSDAQ종합/, "KQ150 must disclose its KOSDAQ composite underlying");
});

test("futures quotes are tradable only when recently fetched and recently traded", () => {
  assert.deepEqual(futuresQuoteState(freshQuote("NQ", 100), NOW), { markable: true, tradable: true, price: 100 });
  assert.equal(futuresQuoteState(freshQuote("NQ", 100, { priceUpdatedAt: iso(-FUTURES_MARKET_MAX_AGE_MS - 1) }), NOW).reason, "MARKET_STALE");
  assert.equal(futuresQuoteState(freshQuote("NQ", 100, { priceUpdatedAt: null }), NOW).tradable, false);
  assert.equal(futuresQuoteState(freshQuote("NQ", 100, { fetchedAt: iso(-FUTURES_FETCH_MAX_AGE_MS - 1) }), NOW).markable, false);
  assert.equal(futuresQuoteState(undefined, NOW).markable, false);
  assert.equal(futuresQuoteState(freshQuote("NQ", Number.NaN), NOW).markable, false);
});

test("opening sends the KRW multiplier; stale or missing quotes are rejected instead of using catalog prices", async () => {
  const database = fakeDatabase({}, async (name, args) => ({ data: { account: { id: 1, krw_balance: 0, usd_balance: 0 }, position: { id: "p", symbol: args.p_symbol, quantity: 1, entry_price: args.p_entry_price, multiplier: args.p_multiplier, margin: 1 } } }));
  const opened = await futures.open(1, { symbol: "NQ", side: "LONG", quantity: 1 }, { database, quotes: quoteSource(freshQuote("NQ", 30771)), now: NOW });
  assert.equal(database.calls[0][1].p_multiplier, 20 * SIMULATED_USD_KRW);
  assert.equal(opened.position.entryPrice, 30771);
  for (const quotes of [quoteSource(), quoteSource(freshQuote("NQ", 30771, { priceUpdatedAt: iso(-2 * 3_600_000) })), quoteSource(freshQuote("NQ", 30771, { fetchedAt: iso(-10 * 60_000) })),
    { loadQuotes: async () => { throw new Error("provider down"); }, getCachedQuotes: () => null }]) {
    await assert.rejects(futures.open(1, { symbol: "NQ", side: "LONG", quantity: 1 }, { database, quotes, now: NOW }),
      (error) => error.status === 503 && error.expose === true && /NASDAQ100 FUT/.test(error.message));
  }
  assert.equal(database.calls.length, 1, "rejected orders must not reach the RPC");
});

test("closing rejects stale quotes and reports pending buys released by the settlement RPC", async () => {
  const tables = { futures_positions: [{ id: "p1", account_id: 1, symbol: "K200" }] };
  const database = fakeDatabase(tables, async () => ({ data: { account: { id: 1, krw_balance: 15000, usd_balance: 0 }, position: { id: "p1" }, pnl: -15000, payout: -5000, current_price: 85,
    cancelled_pending_orders: [{ pending_order_id: "q2", order_id: "o2", released_amount: 10001.5 }] } }));
  await assert.rejects(futures.close(1, "p1", { database, quotes: quoteSource(freshQuote("K200", 85, { priceUpdatedAt: iso(-3_600_000) })), now: NOW }), (error) => error.status === 503);
  const closed = await futures.close(1, "p1", { database, quotes: quoteSource(freshQuote("K200", 85)), now: NOW });
  assert.equal(database.calls.length, 1);
  assert.equal(database.calls[0][1].p_current_price, 85);
  assert.deepEqual(closed.cancelledPendingOrders, [{ pendingOrderId: "q2", orderId: "o2", releasedAmount: 10001.5 }]);
});

test("alternative quotes keep last good values on partial failure and back off failing providers", async () => {
  let clock = NOW;
  const requests = new Map();
  const failing = new Set(["ES=F", "coingecko", "ecos", "treasury"]);
  const chart = (price) => ({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: clock / 1000 - 600, chartPreviousClose: 31402.25 },
    indicators: { quote: [{ close: [31402.25, 30969.5, 31108.75, null, price], open: [], high: [], low: [], volume: [] }] } }] } });
  const fetchImpl = async (url) => {
    const key = url.includes("yahoo") ? decodeURIComponent(url.match(/chart\/([^?]+)/)[1]) : url.includes("coingecko") ? "coingecko" : url.includes("ecos") ? "ecos" : "treasury";
    requests.set(key, (requests.get(key) || 0) + 1);
    if (failing.has(key)) return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
    return { ok: true, status: 200, json: async () => chart(30771), text: async () => "" };
  };
  const service = createAlternativeMarketData({ fetchImpl, now: () => clock });
  const first = await service.loadQuotes();
  const nq = first.items.futures.find((item) => item.symbol === "NQ");
  assert.ok(Math.abs(nq.change - ((30771 - 31108.75) / 31108.75) * 100) < 1e-9, "previous close must be the prior daily bar, not the 5d chartPreviousClose");
  assert.equal(nq.fetchedAt, new Date(NOW).toISOString());
  assert.equal(first.items.futures.some((item) => item.symbol === "ES"), false);
  assert.ok(first.degradedSources.some((item) => item.source === "futures:ES"));

  // NQ fails after a good read: the last good quote stays, keeping its original fetch time.
  failing.add("NQ=F");
  clock += 31_000;
  const second = await service.loadQuotes();
  assert.equal(requests.get("ES=F"), 1, "ES is still backing off and must not be requested");
  const keptNq = second.items.futures.find((item) => item.symbol === "NQ");
  assert.equal(keptNq.fetchedAt, new Date(NOW).toISOString());
  assert.equal(second.items.futures.length, first.items.futures.length, "a provider failure must not empty the futures list");
  assert.equal(futuresQuoteState(keptNq, NOW + 3 * 60_000).markable, false, "aged last-good quotes cannot drive trading or liquidation");

  failing.delete("ES=F");
  clock = NOW + 31_000 + 60_000;
  const third = await service.loadQuotes();
  assert.equal(requests.get("ES=F"), 2, "ES is retried after its backoff window");
  assert.ok(third.items.futures.some((item) => item.symbol === "ES"));
});

test("missing provider timestamps stay null instead of being stamped as fresh", async () => {
  const fetchImpl = async (url) => ({ ok: url.includes("yahoo"), status: 200, text: async () => "",
    json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 100 }, indicators: { quote: [{ close: [99, 100] }] } }] } }) });
  const payload = await createAlternativeMarketData({ fetchImpl, now: () => NOW }).loadQuotes();
  const quote = payload.items.futures[0];
  assert.equal(quote.priceUpdatedAt, null);
  assert.equal(futuresQuoteState(quote, NOW).tradable, false);
});

const position = (id, pnl, overrides = {}) => ({ id, symbol: "K200", margin: 10000, pnl, equity: 10000 + pnl, ratio: (10000 + pnl) / 10000, markable: true, tradable: true, currentPrice: 100, ...overrides });

test("risk status, deficit and ratio share one cash-inclusive basis", () => {
  // Futures alone are at 40% of margin, but free cash covers the loss.
  const covered = assessAccountRisk({ cash: 1_000_000, positions: [position("a", -6000)] });
  assert.equal(covered.status, "SAFE");
  assert.equal(covered.deficit, 0);
  for (const cash of [0, 1000, 3000, 4000, 6000, 20000]) {
    const result = assessAccountRisk({ cash, positions: [position("a", -6000)] });
    assert.equal(["MARGIN_CALL", "LIQUIDATION"].includes(result.status), result.deficit > 0, `cash ${cash}: ${result.status} vs deficit ${result.deficit}`);
    assert.equal(result.marginRatio, result.equity / result.requiredMargin);
  }
  const finance = assessAccountRisk({ cash: 120000, debt: 100000 });
  assert.equal(finance.status, "MARGIN_CALL");
  assert.equal(finance.deficit, 20000);
  assert.equal(assessAccountRisk({ cash: 0 }).status, "SAFE");
});

test("liquidation closes the worst tradable positions until the deficit clears", () => {
  const mild = { cash: 0, debt: 0, positions: [position("good", -1000), position("worst", -9800)] };
  assert.equal(assessAccountRisk(mild).status, "LIQUIDATION");
  assert.deepEqual(planLiquidation(mild).map((item) => item.id), ["worst"]);
  const severe = { cash: 0, debt: 0, positions: [position("bad", -6000), position("worst", -9800)] };
  assert.deepEqual(planLiquidation(severe).map((item) => item.id), ["worst", "bad"]);
  const closedMarket = { ...severe, positions: [position("bad", -6000), position("worst", -9800, { tradable: false })] };
  assert.deepEqual(planLiquidation(closedMarket).map((item) => item.id), ["bad"], "closed-market positions are valued but not liquidated");
  const unpriced = { ...severe, positions: [position("bad", -6000), position("worst", -9800, { markable: false, tradable: false })] };
  assert.deepEqual(planLiquidation(unpriced), [], "unknown equity must not trigger liquidation");
});

test("positions never fall back to catalog prices", () => {
  const row = { id: "p", symbol: "K200", side: "LONG", quantity: 1, entry_price: 900, multiplier: 250000, margin: 18000000 };
  const outage = evaluateFuturesPosition(row, freshQuote("K200", 950, { fetchedAt: iso(-10 * 60_000) }), NOW);
  assert.equal(outage.markable, false);
  assert.equal(outage.currentPrice, 950, "display uses the last received price");
  assert.equal(evaluateFuturesPosition(row, undefined, NOW).currentPrice, 900, "no quote at all keeps entry price, not the static catalog price");
});

const riskTables = (cash, positions) => ({
  accounts: [{ id: 9, krw_balance: cash }], futures_positions: positions, finance_contracts: [], holdings: [], short_positions: [], risk_snapshots: [],
  risk_policies: [{ code: "FUTURES", warning_ratio: 0.85, margin_call_ratio: 0.75, liquidation_ratio: 0.5 }, { code: "FINANCE", warning_ratio: 1.5, margin_call_ratio: 1.4, liquidation_ratio: 1.2 }],
});
const row = (id, entry) => ({ id, account_id: 9, symbol: "K200", side: "LONG", quantity: 1, entry_price: entry, multiplier: 1000, margin: 10000, created_at: id });

test("evaluation skips snapshots and liquidation while quotes are unavailable", async () => {
  const database = fakeDatabase(riskTables(0, [row("p1", 100)]));
  const result = await risk.evaluate(9, { database, quotes: quoteSource(freshQuote("K200", 80, { fetchedAt: iso(-10 * 60_000) })), stockQuote: () => undefined, now: () => NOW });
  assert.equal(result.quotesComplete, false);
  assert.deepEqual(result.unpricedSymbols, ["K200"]);
  assert.equal(result.status, "LIQUIDATION");
  assert.deepEqual(database.calls, [], "no snapshot or forced liquidation without a live quote");
});

test("evaluation liquidates at the live quote and tolerates positions closed concurrently", async () => {
  const tables = riskTables(0, [row("p1", 100), row("p2", 100)]);
  const database = fakeDatabase(tables, async (name, args, state) => {
    if (name === "record_risk_snapshot") return { data: {}, error: null };
    if (args.p_position_id === "p2") return { data: null, error: { code: "P0002", message: "선물 포지션을 찾을 수 없습니다." } };
    state.futures_positions = state.futures_positions.filter((item) => item.id !== args.p_position_id);
    return { data: { pnl: -20000, payout: -10000, deficit: 10000, cancelled_pending_orders: [] }, error: null };
  });
  const result = await risk.evaluate(9, { database, quotes: quoteSource(freshQuote("K200", 80)), stockQuote: () => undefined, now: () => NOW });
  assert.deepEqual(database.calls.map(([name]) => name), ["record_risk_snapshot", "force_liquidate_futures_position", "force_liquidate_futures_position"]);
  assert.equal(database.calls[1][1].p_current_price, 80);
  assert.equal(database.calls[0][1].p_status, "LIQUIDATION");
  assert.deepEqual(result.liquidations.map((item) => item.positionId), ["p1"]);
  assert.equal(result.liquidationFailures, undefined);
});

test("the server risk monitor walks every futures account without browser polling", async () => {
  const tables = { futures_positions: [{ account_id: 3 }, { account_id: 1 }, { account_id: 3 }, { account_id: 7 }] };
  const seen = [];
  const monitor = createRiskMonitor({
    database: () => fakeDatabase(tables), enabled: () => true, maxAccounts: 2, logger: { warn() {}, error() {} },
    evaluateAccount: async (accountId) => { seen.push(accountId); return { liquidations: accountId === 7 ? [{ deficit: 0 }] : [] }; },
  });
  assert.equal((await monitor.runOnce()).checked, 2);
  const second = await monitor.runOnce();
  assert.equal(second.liquidated, 1);
  await monitor.runOnce();
  assert.deepEqual(seen, [1, 3, 7, 1, 3], "cursor resumes after the budgeted batch and wraps to the first account");
});

test("dashboard P&L uses the stored KRW multiplier and tolerates missing quotes", () => {
  const nq = INITIAL_MARKETS.futures.find((asset) => asset.symbol === "NQ");
  assert.equal(futuresPositionPnl({ side: "LONG", entryPrice: 100, quantity: 1, multiplier: 27600 }, { ...nq, price: 101 }), 27600);
  assert.equal(futuresPositionPnl({ side: "SHORT", entryPrice: 100, quantity: 2, multiplier: 20 }, { ...nq, price: 101 }), -40, "legacy positions keep the multiplier they were opened with");
  assert.equal(futuresPositionPnl({ side: "LONG", entryPrice: 100, quantity: 1 }, undefined), null);
});
