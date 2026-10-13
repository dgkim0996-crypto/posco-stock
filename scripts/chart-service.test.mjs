import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateMinutes,
  candle,
  padWithDailyCloses,
  parseKoreanDateTime,
  parseOverseasDateTime,
  previousCloseCandles,
  sortCandles,
} from "../server/services/charts/chartTransforms.js";

test("provider values normalize to a valid OHLCV candle without mutating inputs", () => {
  const row = { open: "110", high: "105", low: "120", close: "108", volume: "42" };
  const result = candle("2026-09-21T09:00:00+09:00", row.open, row.high, row.low, row.close, row.volume);
  assert.deepEqual(result, {
    time: "2026-09-21T09:00:00+09:00", open: 110, high: 110, low: 108, close: 108, volume: 42,
  });
  assert.deepEqual(row, { open: "110", high: "105", low: "120", close: "108", volume: "42" });
  assert.equal(candle("", 1, 1, 1, 1, 1), null);
  assert.equal(candle("2026-09-21", 1, 1, 1, 0, 1), null);
});

test("domestic and overseas date fields keep their established timezone semantics", () => {
  assert.equal(parseKoreanDateTime("20260921", "93001"), "2026-09-21T09:30:01+09:00");
  assert.equal(parseOverseasDateTime("20260921", "93001"), "2026-09-21T09:30:01");
  assert.equal(parseKoreanDateTime("bad"), null);
});

test("minute aggregation preserves first open, last close, extrema and summed volume", () => {
  const items = [
    { time: "2026-09-21T00:01:00.000Z", open: 100, high: 103, low: 99, close: 102, volume: 10 },
    { time: "2026-09-21T00:04:00.000Z", open: 102, high: 106, low: 101, close: 105, volume: 20 },
    { time: "2026-09-21T00:05:00.000Z", open: 105, high: 107, low: 104, close: 106, volume: 5 },
  ];
  assert.deepEqual(aggregateMinutes(items, 5), [
    { time: "2026-09-21T00:00:00.000Z", open: 100, high: 106, low: 99, close: 105, volume: 30 },
    { time: "2026-09-21T00:05:00.000Z", open: 105, high: 107, low: 104, close: 106, volume: 5 },
  ]);
});

test("sorting removes invalid entries and orders provider candles by timestamp", () => {
  const later = { time: "2026-09-22T00:00:00Z", close: 2 };
  const earlier = { time: "2026-09-21T00:00:00Z", close: 1 };
  assert.deepEqual(sortCandles([later, null, earlier]), [earlier, later]);
});

test("empty intraday data falls back to two points from the latest daily close", () => {
  assert.deepEqual(previousCloseCandles([]), []);
  const result = previousCloseCandles([
    { time: "2026-09-20T00:00:00Z", close: 100 },
    { time: "2026-09-21T00:00:00Z", close: 123 },
  ]);
  assert.deepEqual(result.map(({ time, close, volume }) => [time, close, volume]), [
    ["2026-09-21T09:00:00+09:00", 123, 0],
    ["2026-09-21T15:30:00+09:00", 123, 0],
  ]);
});

test("daily-close padding excludes occupied days, remains sorted and respects its limit", () => {
  const minutes = [{ time: "2026-09-21T10:00:00+09:00", open: 130, high: 132, low: 129, close: 131, volume: 8 }];
  const days = [
    { time: "2026-09-19T00:00:00Z", close: 110 },
    { time: "2026-09-20T00:00:00Z", close: 120 },
    { time: "2026-09-21T00:00:00Z", close: 125 },
  ];
  const result = padWithDailyCloses(minutes, days, 3);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.close), [110, 120, 131]);
  assert.ok(result.every((item, index) => index === 0 || new Date(result[index - 1].time) <= new Date(item.time)));
});
