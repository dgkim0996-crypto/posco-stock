import { instruments } from "../data/instruments.data.js";
import { VALID_PERIODS, createError } from "./charts/chartConfig.js";
import { cache, storeChart } from "./charts/chartCache.js";
import { fetchAndCacheChart } from "./charts/chartLoader.js";
import { fetchYahooMinutes } from "./charts/yahooChartClient.js";

// 같은 차트를 여러 요청이 동시에 백그라운드 갱신하지 못하도록 작업을 추적한다.
const refreshing = new Map();

// 저장값은 먼저 보여주고 최신 값은 뒤에서 갱신하는 stale-while-revalidate 처리다.
const refreshInBackground = (instrument, period, key) => {
  if (refreshing.has(key)) return;
  const task = fetchAndCacheChart(instrument, period, key)
    .catch((error) => console.warn(`[KIS 차트] ${key} 갱신 실패, 저장 데이터 유지:`, error.message))
    .finally(() => refreshing.delete(key));
  refreshing.set(key, task);
};

// 메모리/SQLite 복원값을 우선 반환하고, 저장값이 없을 때만 KIS 응답을 기다린다.
const getChart = async (symbol, period) => {
  if (!VALID_PERIODS.has(period)) throw createError(400, "period는 1m, 5m, 30m, 60m, day 중 하나여야 합니다.");
  const instrument = instruments.find((item) => item.symbol.toLowerCase() === symbol.toLowerCase());
  if (!instrument) throw createError(404, "종목을 찾을 수 없습니다.");

  const key = `${period}:${instrument.symbol}`;
  let cached = cache.get(key);
  // 이전 방식으로 만든 짧거나 종가 보충형 분봉은 실제 장기 분봉으로 즉시 교체한다.
  const hasSyntheticCloses = cached?.items?.filter((item) => Number(item.volume) === 0).length > 10;
  if (cached && (period === "5m" || period === "30m" || period === "60m") && (cached.items.length < 60 || hasSyntheticCloses)) {
    try {
      const items = await fetchYahooMinutes(instrument, period);
      if (items.length >= 2) cached = storeChart(instrument.symbol, period, key, items);
    } catch (error) {
      console.warn(`[Yahoo 차트] ${key} 기존 캐시 교체 실패, 저장 데이터 유지:`, error.message);
    }
  }
  if (cached) {
    // 만료된 데이터도 즉시 응답하되 최신 조회는 백그라운드에서 실행한다.
    const stale = !(cached.expiresAt > Date.now());
    if (stale) refreshInBackground(instrument, period, key);
    return { symbol: instrument.symbol, period, candles: cached.items, source: stale ? "저장된 KIS" : "KIS", savedAt: cached.savedAt, stale };
  }

  return fetchAndCacheChart(instrument, period, key);
};

export default { getChart };
