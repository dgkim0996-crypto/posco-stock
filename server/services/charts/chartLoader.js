import kisAuthService from "../kisAuth.service.js";
import { MINUTE_PERIODS, createError } from "./chartConfig.js";
import { aggregateMinutes, padWithDailyCloses, previousCloseCandles } from "./chartTransforms.js";
import { fetchDomesticDays, fetchDomesticMinutes, fetchOverseasDays, fetchOverseasMinutes } from "./kisChartClient.js";
import { fetchYahooMinutes } from "./yahooChartClient.js";
import { storeChart } from "./chartCache.js";

// 시장과 기간에 맞는 KIS API를 호출한 뒤 정상 결과만 저장한다.
export const fetchAndCacheChart = async (instrument, period, key) => {
  let items;
  let source = "KIS";
  // 5·30·60분봉은 시장 구분 없이 실제 장중 봉 60개를 한 번에 받는다.
  // 당일 1분봉만 집계하면 장 초반 5분봉 개수가 부족하므로 5분봉도 장기 제공처를 우선한다.
  if (period === "5m" || period === "30m" || period === "60m") {
    try {
      items = await fetchYahooMinutes(instrument, period);
      if (items.length >= 2) {
        const entry = storeChart(instrument.symbol, period, key, items);
        return { symbol: instrument.symbol, period, candles: items, source: "Yahoo Finance", savedAt: entry.savedAt, stale: false };
      }
    } catch (error) {
      console.warn(`[Yahoo 차트] ${instrument.symbol} ${period} 조회 실패, KIS로 대체:`, error.message);
    }
  }

  const token = await kisAuthService.getAccessToken();
  if (period === "day") {
    items = instrument.currency === "KRW"
      ? await fetchDomesticDays(instrument, token)
      : await fetchOverseasDays(instrument, token);
  } else {
    const periodMinutes = MINUTE_PERIODS.get(period);
    try {
      const minutes = instrument.currency === "KRW"
        ? await fetchDomesticMinutes(instrument, token)
        : await fetchOverseasMinutes(instrument, token, periodMinutes);
      items = periodMinutes === 1 || instrument.currency !== "KRW"
        ? minutes
        : aggregateMinutes(minutes, periodMinutes);
    } catch (error) {
      console.warn(`[KIS 분봉] ${instrument.symbol} ${period} 조회 실패, 직전 종가로 대체:`, error.message);
      items = [];
    }
    if (!items.length) {
      const days = instrument.currency === "KRW"
        ? await fetchDomesticDays(instrument, token)
        : await fetchOverseasDays(instrument, token);
      items = previousCloseCandles(days);
      source = "직전 영업일 종가";
    } else if (instrument.currency === "KRW" && (period === "30m" || period === "60m") && items.length < 60) {
      items = padWithDailyCloses(items, await fetchDomesticDays(instrument, token));
      source = "KIS 분봉 + 최근 영업일 종가";
    }
  }
  if (!items.length) throw createError(404, "조회된 차트 데이터가 없습니다.");
  const entry = storeChart(instrument.symbol, period, key, items);

  return { symbol: instrument.symbol, period, candles: items, source, savedAt: entry.savedAt, stale: false };
};
