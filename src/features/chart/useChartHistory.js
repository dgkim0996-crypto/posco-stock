import { useState, useRef, useEffect } from "react";
import { loadChartCache } from "./chartStorage.js";
import { seedChartValues, buildSyntheticCandles } from "./syntheticCandles.js";
import { apiUrl } from "../../utils/api.js";
import { isStockCategory } from "../market/marketHelpers.js";
import { CHART_CACHE_KEY, CHART_CACHE_RECENT_KEY } from "../preferences/storageKeys.js";
import { readStorage, removeStorage, writeStorage } from "../preferences/preferenceStorage.js";

// 브라우저 저장공간을 넘지 않도록 최근에 차트를 연 종목만 남긴다.
export const CHART_CACHE_SYMBOL_LIMIT = 8;
// 캐시 키는 "종목" 또는 "종목:기간" 형식이므로 앞부분으로 소유 종목을 구분한다.
const chartKeyOwner = (key) => String(key).split(":", 1)[0];

function loadRecentChartOwners() {
  try {
    const saved = JSON.parse(readStorage(CHART_CACHE_RECENT_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((owner) => typeof owner === "string" && owner) : [];
  } catch {
    return [];
  }
}

// 방금 사용한 종목을 가장 앞에 두는 LRU 순서로 저장하고, 용량 초과 시 오래된 종목부터 줄여 다시 시도한다.
export function saveChartCache(cache, asset, limit = CHART_CACHE_SYMBOL_LIMIT) {
  const touched = [...new Set([asset?.symbol, asset?.id].filter(Boolean).map(String))];
  let recent = [...touched, ...loadRecentChartOwners().filter((owner) => !touched.includes(owner))].slice(0, Math.max(limit, touched.length));
  const entries = Object.entries(cache || {});
  while (recent.length) {
    const owners = new Set(recent);
    const kept = Object.fromEntries(entries.filter(([key]) => owners.has(chartKeyOwner(key))));
    if (writeStorage(CHART_CACHE_KEY, JSON.stringify(kept))) {
      writeStorage(CHART_CACHE_RECENT_KEY, JSON.stringify(recent));
      return true;
    }
    recent = recent.slice(0, Math.floor(recent.length / 2));
  }
  // 한 종목도 저장할 수 없으면 손상·과대 캐시가 다음 실행을 막지 않도록 지운다.
  removeStorage(CHART_CACHE_KEY);
  removeStorage(CHART_CACHE_RECENT_KEY);
  return false;
}

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useChartHistory({
  selected, category, marketCategory,
}) {
  const [chartData, setChartData] = useState(loadChartCache);

  const [chartPeriod, setChartPeriod] = useState("1m");

  const [chartIndicators, setChartIndicators] = useState([]);

  const [chartLoading, setChartLoading] = useState(false);

  const [chartError, setChartError] = useState("");

  const chartRequestPromises = useRef(new Map());

  // 새 봉 데이터를 받은 종목을 기록해 두고, 상태 반영이 끝난 뒤 업데이터 밖에서 한 번만 저장한다.
  const pendingChartSave = useRef(null);

  useEffect(() => {
    const asset = pendingChartSave.current;
    if (!asset) return;
    pendingChartSave.current = null;
    saveChartCache(chartData, asset);
  }, [chartData]);

  useEffect(() => {
    setChartData((prev) => {
      const old = prev[selected.id];
      const base = old?.length ? old : seedChartValues(selected.price);
      const next = { ...prev, [selected.id]: [...base, selected.price].slice(-96) };
      if (selected.synthetic) {
        for (const period of ["1m", "5m", "30m", "60m", "day"]) {
          const key = `${selected.symbol}:${period}`;
          const candles = next[key];
          if (!Array.isArray(candles) || !candles.length) continue;
          const last = candles.at(-1);
          next[key] = [...candles.slice(0, -1), {
            ...last,
            close: selected.price,
            high: Math.max(last.high, selected.price),
            low: Math.min(last.low, selected.price),
          }];
        }
      }
      return next;
    });
  }, [selected.id, selected.price]);

  useEffect(() => {
    let active = true;
    let timer;
    let preloadTimer;
    const key = `${selected.symbol}:${chartPeriod}`;
    const normalRefreshMs = chartPeriod === "day" ? 300_000 : 60_000;

    const requestChart = (period) => {
      const requestKey = `${selected.symbol}:${period}`;
      const pendingRequest = chartRequestPromises.current.get(requestKey);
      if (pendingRequest) return pendingRequest;

      const request = (async () => {
        if (selected.synthetic) {
          const componentSymbols = selected.components || ["005930", "000660"];
          const responses = await Promise.all(componentSymbols.map((symbol) => (
            fetch(apiUrl(`/api/charts/${encodeURIComponent(symbol)}?period=${period}`))
          )));
          const payloads = await Promise.all(responses.map(async (response) => {
            const payload = await response.json();
            if (!response.ok) {
              const error = new Error(payload.error || `기초종목 차트 API 오류 (${response.status})`);
              error.retryAfter = Number(payload.retryAfter) || Number(response.headers.get("Retry-After")) || 0;
              throw error;
            }
            return payload;
          }));
          return { candles: buildSyntheticCandles(payloads[0]?.candles, payloads[1]?.candles, selected.price, selected.leverage || 10) };
        }

        const chartUrl = isStockCategory(category)
          ? `/api/charts/${encodeURIComponent(selected.symbol)}?period=${period}`
          : `/api/alternative-charts/${marketCategory}/${encodeURIComponent(selected.symbol)}?period=${period}`;
        const response = await fetch(apiUrl(chartUrl));
        const payload = await response.json();
        if (!response.ok) {
          const error = new Error(payload.error || `차트 API 오류 (${response.status})`);
          error.retryAfter = Number(payload.retryAfter) || Number(response.headers.get("Retry-After")) || 0;
          throw error;
        }
        return payload;
      })();

      chartRequestPromises.current.set(requestKey, request);
      request.then(
        () => chartRequestPromises.current.delete(requestKey),
        () => chartRequestPromises.current.delete(requestKey),
      );
      return request;
    };

    // 현재 기간을 요청하고 성공하면 React 상태와 브라우저 캐시를 함께 갱신한다.
    const loadChart = async () => {
      let nextRefreshMs = normalRefreshMs;
      setChartLoading(true);
      try {
        const data = await requestChart(chartPeriod);
        if (!Array.isArray(data.candles) || data.candles.length < 2) throw new Error("합성할 수 있는 기초종목 차트 데이터가 부족합니다.");
        if (!active) return;
        // 이후 기간 전환과 새로고침에서 재사용할 실제 봉 데이터다.
        pendingChartSave.current = { symbol: selected.symbol, id: selected.id };
        setChartData((prev) => ({ ...prev, [key]: data.candles || [] }));
        setChartError("");

        // 현재 선택 차트를 먼저 그린 뒤, 잠시 후 다른 기간을 하나씩 준비한다.
        // 동시에 여러 KIS 요청을 보내면 사용자가 누른 기간보다 사전 요청이 먼저 처리될 수 있다.
        if (chartPeriod === "1m") {
          preloadTimer = window.setTimeout(async () => {
            for (const period of ["5m", "30m", "60m", "day"]) {
              if (!active) break;
              try {
                const preloadData = await requestChart(period);
                const preloadKey = `${selected.symbol}:${period}`;
                if (!active || !Array.isArray(preloadData?.candles) || !preloadData.candles.length) continue;
                pendingChartSave.current = { symbol: selected.symbol, id: selected.id };
                setChartData((prev) => ({ ...prev, [preloadKey]: preloadData.candles }));
              } catch {
                // 사전 준비 실패는 현재 보고 있는 차트의 오류로 표시하지 않는다.
              }
            }
          }, 800);
        }
      } catch (error) {
        if (error.retryAfter) nextRefreshMs = error.retryAfter * 1000;
        if (active) setChartError(error.message || "실제 차트 데이터를 불러오지 못했습니다.");
      } finally {
        if (active) {
          setChartLoading(false);
          timer = window.setTimeout(loadChart, nextRefreshMs);
        }
      }
    };

    loadChart();
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(preloadTimer);
    };
  }, [category, selected.symbol, chartPeriod]);

  return {
    chartData, setChartData, chartPeriod, setChartPeriod, chartIndicators, setChartIndicators,
    chartLoading, chartError,
  };
}
