import { SIMULATED_USD_KRW as USD_KRW } from "../../../shared/tradingRules.js";
import { LABELS } from "./marketConstants.js";

export function spotPriceInKRW(asset) {
  if (!asset) return 0;
  return asset.unit === "USD" ? asset.price * USD_KRW : asset.price;
}

export function stockRegionOf(asset) {
  return asset.unit === "USD" ? "overseas" : "domestic";
}

export function marketCategoryOf(category) {
  return category === "domesticStocks" || category === "overseasStocks" ? "stocks" : category;
}

export function isStockCategory(category) {
  return marketCategoryOf(category) === "stocks";
}

export function displayCategoryLabel(category, asset) {
  if (category !== "stocks") return LABELS[category];
  return stockRegionOf(asset) === "domestic" ? LABELS.domesticStocks : LABELS.overseasStocks;
}
