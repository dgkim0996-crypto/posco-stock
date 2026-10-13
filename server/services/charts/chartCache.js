import marketDatabaseService from "../marketDatabase.service.js";

// SQLite 차트를 메모리에 올려 장 종료나 외부 API 장애 때도 즉시 응답한다.
export const cache = marketDatabaseService.loadCharts();

// 새 차트를 메모리와 SQLite에 함께 저장하고 기간별 갱신 유효시간도 기록한다.
export const storeChart = (symbol, period, key, items) => {
  const savedAt = new Date().toISOString();
  const entry = { items, savedAt, expiresAt: Date.now() + (period === "day" ? 300_000 : 30_000) };
  cache.set(key, entry);
  try {
    marketDatabaseService.saveChart(symbol, period, entry);
  } catch (error) {
    console.warn(`[SQLite 차트] ${key} 저장 실패:`, error.message);
  }
  return entry;
};
