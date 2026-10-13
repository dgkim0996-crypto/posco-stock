import { CHART_CACHE_KEY } from "../preferences/storageKeys.js";

export function loadChartCache() {
  if (typeof window === "undefined") return {};
  try {
    const saved = JSON.parse(window.localStorage.getItem(CHART_CACHE_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}
