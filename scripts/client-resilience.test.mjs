import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";

const rootPath = path.resolve(import.meta.dirname, "..");
const requirePackage = createRequire(import.meta.url);
const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
after(() => dom.window.close());

// Vite 전용 import.meta.env와 Supabase 클라이언트를 쓰는 모듈은 테스트 대역으로 바꿔 JSX 원본을 그대로 실행한다.
const stubs = {
  [path.join(rootPath, "src/utils/api.js")]: { apiUrl: (value) => value, websocketUrl: (value) => value, apiFetch: async () => new Response("{}") },
};
const cache = new Map();
function load(filename) {
  const resolved = path.resolve(filename);
  if (stubs[resolved]) return stubs[resolved];
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const module = { exports: {} };
  cache.set(resolved, module);
  const code = transformSync(fs.readFileSync(resolved, "utf8"), { loader: resolved.endsWith(".jsx") ? "jsx" : "js", format: "cjs", jsx: "automatic" }).code;
  const localRequire = (specifier) => specifier.startsWith(".") ? load(path.resolve(path.dirname(resolved), specifier)) : requirePackage(specifier);
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}

const { saveChartCache, CHART_CACHE_SYMBOL_LIMIT } = load(path.join(rootPath, "src/features/chart/useChartHistory.js"));
const { CHART_CACHE_KEY, CHART_CACHE_RECENT_KEY } = load(path.join(rootPath, "src/features/preferences/storageKeys.js"));
const { default: ErrorBoundary } = load(path.join(rootPath, "src/components/ErrorBoundary.jsx"));
const { useDashboardLayout } = load(path.join(rootPath, "src/features/dashboard/useDashboardLayout.js"));
const { useTradingPreferences } = load(path.join(rootPath, "src/features/preferences/useTradingPreferences.js"));

const candles = (symbol) => [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1, symbol }];
const chartCacheFor = (symbols) => Object.fromEntries(symbols.flatMap((symbol) => [[symbol, [1, 2]], [`${symbol}:1m`, candles(symbol)], [`${symbol}:day`, candles(symbol)]]));
const savedOwners = () => [...new Set(Object.keys(JSON.parse(window.localStorage.getItem(CHART_CACHE_KEY))).map((key) => key.split(":")[0]))].sort();

test("chart cache keeps only the most recently viewed symbols", () => {
  window.localStorage.clear();
  const symbols = Array.from({ length: CHART_CACHE_SYMBOL_LIMIT + 3 }, (_, index) => String(100000 + index));
  for (const symbol of symbols) assert.equal(saveChartCache(chartCacheFor(symbols), { symbol, id: symbol }), true);
  assert.deepEqual(savedOwners(), symbols.slice(-CHART_CACHE_SYMBOL_LIMIT).sort());
  // 다시 연 종목은 최근 목록 앞으로 이동해 다음 저장에서 밀려나지 않는다.
  saveChartCache(chartCacheFor(symbols), { symbol: symbols.at(-CHART_CACHE_SYMBOL_LIMIT), id: symbols.at(-CHART_CACHE_SYMBOL_LIMIT) });
  saveChartCache(chartCacheFor(symbols), { symbol: symbols[0], id: symbols[0] });
  assert.equal(JSON.parse(window.localStorage.getItem(CHART_CACHE_RECENT_KEY))[1], symbols.at(-CHART_CACHE_SYMBOL_LIMIT));
  assert.equal(savedOwners().includes(symbols.at(-CHART_CACHE_SYMBOL_LIMIT + 1)), false);
});

test("chart cache shrinks on quota errors instead of throwing", () => {
  window.localStorage.clear();
  const symbols = ["111111", "222222", "333333", "444444"];
  for (const symbol of symbols) saveChartCache(chartCacheFor(symbols), { symbol, id: symbol });
  const storage = Object.getPrototypeOf(window.localStorage);
  const originalSetItem = storage.setItem;
  // 차트 캐시가 2종목을 넘으면 저장공간 초과가 나는 브라우저를 흉내 낸다.
  storage.setItem = function setItem(key, value) {
    if (key === CHART_CACHE_KEY && new Set(Object.keys(JSON.parse(value)).map((item) => item.split(":")[0])).size > 2) {
      throw new window.DOMException("quota", "QuotaExceededError");
    }
    return originalSetItem.call(this, key, value);
  };
  try {
    assert.equal(saveChartCache(chartCacheFor([...symbols, "555555"]), { symbol: "555555", id: "555555" }), true);
    assert.deepEqual(savedOwners(), ["444444", "555555"]);
    storage.setItem = () => { throw new window.DOMException("quota", "QuotaExceededError"); };
    assert.equal(saveChartCache(chartCacheFor(symbols), { symbol: "111111", id: "111111" }), false);
    assert.equal(window.localStorage.getItem(CHART_CACHE_KEY), null, "unwritable cache is cleared");
  } finally {
    storage.setItem = originalSetItem;
  }
});

const render = async (element) => {
  const container = document.getElementById("root");
  const root = createRoot(container);
  await React.act(async () => root.render(element));
  return { container, unmount: () => React.act(async () => root.unmount()) };
};

test("preference and dashboard hooks keep working when localStorage access is blocked", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new window.DOMException("blocked", "SecurityError"); } });
  window.matchMedia = () => ({ matches: false });
  let result;
  function Probe() {
    const layout = useDashboardLayout();
    const preferences = useTradingPreferences({ session: { user: { id: "user-1" } }, setMainTab() {}, setCategory() {}, setSelectedId() {}, setOrderTab() {} });
    result = { layout, preferences };
    return React.createElement("p", null, preferences.theme);
  }
  try {
    const view = await render(React.createElement(Probe));
    assert.equal(view.container.textContent, "light");
    await React.act(async () => {
      result.preferences.setTheme("dark");
      result.preferences.dismissWelcomeGuide();
      result.layout.updateDashboardWidget(result.layout.dashboardWidgets[0].id, { collapsed: true });
    });
    assert.equal(view.container.textContent, "dark");
    await view.unmount();
  } finally {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    else delete window.localStorage;
  }
});

test("the top-level error boundary replaces a crashed tree with recovery actions", async () => {
  let shouldThrow = true;
  function Unstable() {
    if (shouldThrow) throw new Error("render failure with internal detail");
    return React.createElement("p", null, "복구됨");
  }
  const originalError = console.error;
  console.error = () => {};
  try {
    const view = await render(React.createElement(ErrorBoundary, null, React.createElement(Unstable)));
    assert.match(view.container.textContent, /화면을 표시하는 중 문제가 발생했습니다/);
    assert.doesNotMatch(view.container.textContent, /internal detail/);
    shouldThrow = false;
    const retry = [...view.container.querySelectorAll("button")].find((button) => button.textContent.trim() === "다시 시도");
    await React.act(async () => retry.click());
    assert.equal(view.container.textContent, "복구됨");
    await view.unmount();
  } finally {
    console.error = originalError;
  }
});
