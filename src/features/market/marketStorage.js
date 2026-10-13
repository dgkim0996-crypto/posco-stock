import { INITIAL_MARKETS } from "../../data/markets.js";
import { MARKET_CACHE_KEY } from "../preferences/storageKeys.js";

export function cloneMarkets() {
  const initial = JSON.parse(JSON.stringify(INITIAL_MARKETS));
  if (typeof window === "undefined") return initial;
  try {
    // 기본 종목 정보에 브라우저가 기억한 마지막 정상 가격을 합친다.
    const saved = JSON.parse(window.localStorage.getItem(MARKET_CACHE_KEY) || "null");
    const quoteMap = new Map((Array.isArray(saved) ? saved : []).map((quote) => [quote.symbol, quote]));
    initial.stocks = initial.stocks.map((asset) => {
      const quote = quoteMap.get(asset.symbol);
      return quote && Number.isFinite(quote.price) ? { ...asset, ...quote } : asset;
    });
  } catch {
    // 손상된 브라우저 캐시는 초기 데이터로 대체한다.
  }
  return initial;
}
