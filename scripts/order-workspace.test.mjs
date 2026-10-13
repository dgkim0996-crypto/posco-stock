import assert from "node:assert/strict";
import test from "node:test";
import { buildOrderRows, filterOrderRows, formatOrderDateTime, isOrderDateKey, kstDateKey, orderMatchesStatus, orderRowsToCsv, orderStatus, summarizeOrderRows } from "../src/utils/orderWorkspace.js";

const assets = [
  { id: "005490", symbol: "005490", name: "POSCO홀딩스", unit: "KRW", market: "KOSPI" },
  { id: "AAPL", symbol: "AAPL", name: "Apple", unit: "USD", market: "NASDAQ" },
];
const partial = { id: "41", symbol: "005490", side: "BUY", orderType: "LIMIT", quantity: 10, filledQuantity: 3, remainingQuantity: 7, cancelledQuantity: 0, status: "PARTIALLY_FILLED", limitPrice: 300000, executionPrice: 299500, feeAmount: 10, taxAmount: 0, createdAt: "2026-09-17T15:00:00Z" };
const pending = { id: "p-41", orderId: "41", symbol: "005490", side: "BUY", quantity: 7, limitPrice: 300000, createdAt: partial.createdAt };

test("linked pending and order records merge once, preserving the actionable original pending object", () => {
  const rows = buildOrderRows([partial, partial], [pending, pending], assets);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 10);
  assert.equal(rows[0].remainingQuantity, 7);
  assert.equal(rows[0].filledQuantity, 3);
  assert.strictEqual(rows[0].pendingOrder, pending);
  assert.equal(rows[0].name, "POSCO홀딩스");
  assert.equal(orderStatus(rows[0]).label, "부분체결");
});

test("independent same-symbol pending orders are never collapsed by symbol or side", () => {
  const otherPending = { ...pending, id: "p-42", orderId: null };
  const rows = buildOrderRows([partial], [pending, otherPending], assets);
  assert.equal(rows.length, 2);
  const pendingOnly = rows.find((row) => row.key === "pending:p-42");
  assert.equal(pendingOnly.quantity, null, "remaining quantity must not masquerade as original order quantity");
  assert.equal(pendingOnly.filledQuantity, null);
  assert.equal(pendingOnly.remainingQuantity, 7);
  assert.equal(pendingOnly.incomplete, true);
});

test("a partial fill followed by cancellation appears in both filled and cancelled filters", () => {
  const rows = buildOrderRows([{ ...partial, remainingQuantity: 0, cancelledQuantity: 7, status: "CANCELLED" }], [pending], assets);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pendingOrder, null, "stale pending state must not expose actions on a cancelled order");
  assert.equal(orderStatus(rows[0]).label, "부분체결 · 잔량취소");
  assert.equal(orderMatchesStatus(rows[0], "filled"), true);
  assert.equal(orderMatchesStatus(rows[0], "cancelled"), true);
  assert.equal(orderMatchesStatus(rows[0], "pending"), false);
  assert.equal(summarizeOrderRows(rows).buyAmount, 898500);
});

test("today and inclusive 7-day filters honor Korean midnight regardless of machine timezone", () => {
  const now = "2026-09-17T15:05:00Z"; // September 18 in Seoul.
  const records = [
    { ...partial, id: "today", createdAt: "2026-09-17T15:00:00Z" },
    { ...partial, id: "yesterday", createdAt: "2026-09-17T14:59:59Z" },
    { ...partial, id: "seven", createdAt: "2026-09-11T15:00:00Z" },
    { ...partial, id: "eight", createdAt: "2026-09-11T14:59:59Z" },
    { ...partial, id: "future", createdAt: "2026-09-18T15:00:00Z" },
    { ...partial, id: "undated", createdAt: undefined },
  ];
  const rows = buildOrderRows(records, [], assets);
  assert.equal(kstDateKey(now), "2026-09-18");
  assert.deepEqual(filterOrderRows(rows, { period: "today", now }).map((row) => row.id), ["today"]);
  assert.deepEqual(filterOrderRows(rows, { period: "7days", now }).map((row) => row.id), ["today", "yesterday", "seven"]);
  assert.equal(filterOrderRows(rows).length, 6);
  assert.equal(formatOrderDateTime("2026-09-17T15:00:00Z").full, "2026-09-18 00:00:00 KST");
});

test("name, symbol, order and pending ID search combine correctly with direction and selection", () => {
  const rows = buildOrderRows([partial, { ...partial, id: "50", symbol: "AAPL", side: "SELL" }], [pending], assets);
  assert.equal(filterOrderRows(rows, { keyword: "posco 홀딩스" })[0].id, "41");
  assert.equal(filterOrderRows(rows, { keyword: "p-41" })[0].id, "41");
  assert.equal(filterOrderRows(rows, { keyword: "aapl", side: "SELL", selectedOnly: true, selectedSymbol: "AAPL" }).length, 1);
  assert.equal(filterOrderRows(rows, { keyword: "aapl", side: "BUY" }).length, 0);
});

test("custom order dates include the whole KST end date and exclude neighboring days", () => {
  const rows = buildOrderRows([
    { ...partial, id: "before", createdAt: "2026-09-09T14:59:59Z" },
    { ...partial, id: "first", createdAt: "2026-09-09T15:00:00Z" },
    { ...partial, id: "last", createdAt: "2026-09-11T14:59:59.999Z" },
    { ...partial, id: "after", createdAt: "2026-09-11T15:00:00Z" },
    { ...partial, id: "undated", createdAt: null },
  ], [], assets);
  const results = filterOrderRows(rows, { period: "custom", startDate: "2026-09-10", endDate: "2026-09-11" });
  assert.deepEqual(results.map((row) => row.id), ["last", "first"]);
  assert.deepEqual(filterOrderRows(rows, { period: "custom", startDate: "2026-09-10", endDate: "2026-09-10" }).map((row) => row.id), ["first"]);
});

test("incomplete, malformed and reversed custom dates never fall back to all orders", () => {
  const rows = buildOrderRows([partial], [], assets);
  for (const [startDate, endDate] of [["", "2026-09-18"], ["2026-09-18", ""], ["2026-09-19", "2026-09-18"], ["2026-02-30", "2026-09-18"], ["2026-9-1", "2026-09-18"]]) {
    assert.deepEqual(filterOrderRows(rows, { period: "custom", startDate, endDate }), []);
  }
  assert.equal(isOrderDateKey("2028-02-29"), true);
  assert.equal(isOrderDateKey("2026-02-29"), false);
});

test("30-day period is inclusive and measured by KST calendar days", () => {
  const rows = buildOrderRows([
    { ...partial, id: "first", createdAt: "2026-08-19T15:00:00Z" },
    { ...partial, id: "before", createdAt: "2026-08-19T14:59:59Z" },
  ], [], assets);
  assert.deepEqual(filterOrderRows(rows, { period: "30days", now: "2026-09-17T15:05:00Z" }).map((row) => row.id), ["first"]);
});

test("USD orders retain KRW ledger prices; standalone pending prices are clearly denominated USD", () => {
  const usdOrder = { ...partial, id: "usd", symbol: "AAPL", limitPrice: 320000, executionPrice: 319000 };
  const usdPending = { ...pending, id: "usd-p", orderId: "usd", symbol: "AAPL", limitPrice: 231.7 };
  const linked = buildOrderRows([usdOrder], [usdPending], assets)[0];
  assert.equal(linked.limitPrice, 320000);
  assert.equal(linked.priceCurrency, "KRW");
  assert.equal(linked.executionPrice, 319000);
  const unlinked = buildOrderRows([], [usdPending], assets)[0];
  assert.equal(unlinked.limitPrice, 231.7);
  assert.equal(unlinked.priceCurrency, "USD");
});

test("CSV includes actual partial quantities, currency, Korean time and safe spreadsheet text", () => {
  const rows = buildOrderRows([{ ...partial, name: '=HYPERLINK("x")', symbol: '=TEST', taxAmount: 4 }], [], []);
  const csv = orderRowsToCsv(rows);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=TEST"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"2026-09-18 00:00:00 KST"'));
  assert.ok(csv.includes('"10","3","7","0","300000","KRW","299500","10","4"'));
  assert.ok(csv.endsWith("\r\n"));
});

test("CSV preserves Korean symbol leading zeroes and does not invent fills for incomplete records", () => {
  const rows = buildOrderRows([], [pending], assets);
  const csv = orderRowsToCsv(rows);
  assert.ok(csv.includes('"\'005490"'));
  assert.ok(csv.includes('"미체결","","","7","","300000","KRW","","","","","미체결 잔량만 조회됨"'));
});

test("cancelled residuals retain their executed cost and derive missing cancellation quantity", () => {
  const rows = buildOrderRows([{ ...partial, status: "CANCELLED", cancelledQuantity: undefined, remainingQuantity: 7 }], [pending], assets);
  assert.equal(rows[0].remainingQuantity, 0);
  assert.equal(rows[0].cancelledQuantity, 7);
  assert.equal(rows[0].filledQuantity, 3);
  assert.equal(rows[0].executionPrice, 299500);
  assert.deepEqual(summarizeOrderRows(rows), { all: 1, pending: 0, filled: 1, cancelled: 1, buyAmount: 898500, sellAmount: 0, costAmount: 10 });
  assert.ok(orderRowsToCsv(rows).includes('"부분체결 · 잔량취소","10","3","0","7"'));
});

test("summary uses executed quantities, includes sell fees and handles missing numeric fields", () => {
  const rows = buildOrderRows([
    partial,
    { ...partial, id: "sell", side: "SELL", status: "FILLED", quantity: 2, filledQuantity: undefined, remainingQuantity: 0, executionPrice: 300100, feeAmount: 7, taxAmount: 100 },
    { ...partial, id: "bad", status: "REJECTED", filledQuantity: 0, feeAmount: NaN, taxAmount: undefined },
  ], [], assets);
  const summary = summarizeOrderRows(rows);
  assert.equal(summary.buyAmount, 898500);
  assert.equal(summary.sellAmount, 600200);
  assert.equal(summary.costAmount, 117);
  assert.equal(summary.pending, 1);
  assert.equal(summary.filled, 2);
  assert.equal(summary.all, 3);
});
