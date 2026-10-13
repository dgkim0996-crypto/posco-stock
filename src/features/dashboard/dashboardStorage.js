import { DEFAULT_DASHBOARD_WIDGETS } from "./dashboardConstants.js";
import { DASHBOARD_STORAGE_KEY, LEGACY_DASHBOARD_STORAGE_KEY } from "../preferences/storageKeys.js";

export function loadDashboardWidgets() {
  if (typeof window === "undefined") return DEFAULT_DASHBOARD_WIDGETS;

  try {
    const raw = window.localStorage.getItem(DASHBOARD_STORAGE_KEY)
      || window.localStorage.getItem(LEGACY_DASHBOARD_STORAGE_KEY)
      || "null";
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return DEFAULT_DASHBOARD_WIDGETS.map((item) => ({ ...item }));

    const known = new Set(DEFAULT_DASHBOARD_WIDGETS.map((item) => item.id));
    const sizeToCols = { full: 12, half: 6, third: 4 };
    const cleaned = saved
      .filter((item) => item && known.has(item.id))
      .map((item) => {
        const fallback = DEFAULT_DASHBOARD_WIDGETS.find((base) => base.id === item.id);
        return {
          id: item.id,
          cols: Math.max(4, Math.min(12, Number(item.cols) || sizeToCols[item.size] || fallback.cols)),
          height: Math.max(250, Math.min(680, Number(item.height) || fallback.height)),
          collapsed: Boolean(item.collapsed),
          hidden: Boolean(item.hidden),
        };
      });

    DEFAULT_DASHBOARD_WIDGETS.forEach((item) => {
      if (!cleaned.some((savedItem) => savedItem.id === item.id)) cleaned.push({ ...item });
    });

    return cleaned;
  } catch {
    return DEFAULT_DASHBOARD_WIDGETS;
  }
}
