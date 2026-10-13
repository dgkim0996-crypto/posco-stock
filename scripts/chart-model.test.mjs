import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCandles, prepareChart } from "../src/features/chart/chartData.js";
import { bollingerBands, calculateIndicators, movingAverage, movingAverageConvergenceDivergence, relativeStrengthIndex } from "../src/features/chart/chartIndicators.js";
import { bandAreaPath, linePath } from "../src/features/chart/chartPaths.js";
import { formatAxisPrice, formatFullPrice } from "../src/features/chart/chartFormatters.js";

const now = Date.parse("2026-09-21T01:00:00Z");
const allCandles = normalizeCandles({ values: Array.from({ length: 80 }, (_, index) => 100 + index), period: "1m" }, now);
const indicatorData = calculateIndicators(allCandles);
const options = {
  allCandles, indicatorData, viewRange: { start: 20, end: 60 }, priceScale: 1, volumeLevel: 1,
  averagePrice: null, tradeMarkers: [], period: "1m", indicators: [],
};

test("provider candles preserve metadata, repair OHLC bounds, and reject invalid closing prices", () => {
  const candles = [
    { time: now, open: "110", high: "101", low: "120", close: "105", volume: "123", source: "provider" },
    { time: now + 60_000, open: 0, close: 106 }, null,
    { time: now, close: "bad" }, { time: now, close: 0 }, { time: now, close: -1 },
  ];
  const normalized = normalizeCandles({ candles });
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], {
    time: new Date(now), open: 110, high: 110, low: 105, close: 105, volume: "123", source: "provider",
  });
  assert.deepEqual(normalized[1], { time: new Date(now + 60_000), open: 106, high: 106, low: 106, close: 106 });
  assert.equal(candles[0].high, "101", "normalization must not mutate provider data");
});

test("simulated price history produces evenly spaced flat candles with no invented volume", () => {
  const simulated = normalizeCandles({ values: [100, NaN, 104, Infinity, 102], period: "5m" }, now);
  assert.deepEqual(simulated.map((item) => item.time.getTime()), [now - 600_000, now - 300_000, now]);
  assert.deepEqual(simulated.map(({ open, high, low, close, volume }) => [open, high, low, close, volume]), [
    [100, 100, 100, 100, 0], [104, 104, 104, 104, 0], [102, 102, 102, 102, 0],
  ]);
});

test("moving average and Bollinger windows retain warmup gaps and known sample values", () => {
  assert.deepEqual(movingAverage([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const bands = bollingerBands([1, 2, 3, 4], 3, 2);
  assert.deepEqual(bands.middle, [null, null, 2, 3]);
  assert.deepEqual(bands.upper.slice(0, 2), [null, null]);
  assert.ok(Math.abs(bands.upper[2] - (2 + 2 * Math.sqrt(2 / 3))) < 1e-12);
  assert.ok(Math.abs(bands.lower[3] - (3 - 2 * Math.sqrt(2 / 3))) < 1e-12);
});

test("RSI and MACD retain their existing rising, falling, and flat-series behavior", () => {
  assert.deepEqual(relativeStrengthIndex([1, 2, 3], 3), [null, null, null]);
  assert.deepEqual(relativeStrengthIndex([1, 2, 3, 4, 5], 3), [null, null, null, 100, 100]);
  assert.deepEqual(relativeStrengthIndex([5, 4, 3, 2, 1], 3), [null, null, null, 0, 0]);
  const macd = movingAverageConvergenceDivergence(Array(30).fill(100));
  assert.ok(Object.values(macd).every((series) => series.length === 30 && series.every((value) => value === 0)));
});

test("panning slices indicators calculated from complete history without restarting their warmup", () => {
  const chart = prepareChart({ ...options, indicators: ["ma20", "rsi", "macd"] });
  assert.equal(chart.normalized.length, 40);
  assert.equal(chart.indicatorSeries.ma20[0], 110.5);
  assert.deepEqual(chart.indicatorSeries.rsi, indicatorData.rsi.slice(20, 60));
  assert.deepEqual(chart.indicatorSeries.macd.macd, indicatorData.macd.macd.slice(20, 60));
  assert.equal(chart.coords[0].x, chart.left);
  assert.equal(chart.coords.at(-1).x, chart.left + chart.plotW);
  assert.ok(chart.indicatorPanels.macd.top > chart.indicatorPanels.rsi.bottom);
});

test("off-screen average cost cannot distort auto range; visible trades remain on the price axis", () => {
  const baseline = prepareChart(options);
  const withAverage = prepareChart({ ...options, averagePrice: 999999 });
  assert.equal(withAverage.min, baseline.min);
  assert.equal(withAverage.max, baseline.max);
  assert.ok(withAverage.averageY < baseline.top);
  const chart = prepareChart({ ...options, tradeMarkers: [
    { id: "visible", time: allCandles[30].time.getTime(), price: 200, side: "BUY" },
    { id: "old", time: allCandles[0].time.getTime(), price: 500 },
    { id: "future", time: now + 600_000, price: 500 },
    { id: "invalid", time: allCandles[30].time.getTime(), price: -10 },
  ] });
  assert.deepEqual(chart.tradeMarkerCoords.map((marker) => marker.id), ["visible"]);
  assert.equal(chart.tradeMarkerCoords[0].x, chart.coords[10].x);
  assert.ok(chart.max > 200);
});

test("vertical scaling and volume size keep visible prices and horizontal coordinates stable", () => {
  const baseline = prepareChart(options);
  const scaled = prepareChart({ ...options, priceScale: 2, volumeLevel: 3 });
  assert.equal(scaled.range, baseline.range * 2);
  assert.deepEqual(scaled.clean, baseline.clean);
  assert.deepEqual(scaled.coords.map((point) => point.x), baseline.coords.map((point) => point.x));
  assert.ok(scaled.volumeHeight > baseline.volumeHeight);
  assert.equal(prepareChart({ ...options, viewRange: { start: 0, end: 1 } }), null);
});

test("indicator paths restart after missing values and close filled bands", () => {
  const coords = [0, 1, 2, 3].map((x) => ({ x }));
  assert.equal(linePath([1, null, 3, 4], coords, (value) => value), "M0.00,1.00 M2.00,3.00 L3.00,4.00");
  assert.equal(bandAreaPath([null, 4, 5], [null, 2, 3], coords, (value) => value), "M1.00,4.00 L2.00,5.00 L2.00,3.00 L1.00,2.00 Z");
  assert.equal(bandAreaPath([null, 4], [null, 2], coords, (value) => value), "");
});

test("axis labels distinguish large prices while tooltips retain their full unit", () => {
  assert.notEqual(formatAxisPrice(310000, {}, 500), formatAxisPrice(310500, {}, 500));
  assert.equal(formatAxisPrice(NaN, {}), "-");
  assert.equal(formatFullPrice(1234, { unit: "KRW" }), `${(1234).toLocaleString()}원`);
  assert.equal(formatFullPrice(1234.25, { unit: "USD" }), `$${(1234.25).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
});
