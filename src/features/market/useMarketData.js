import { useState, useEffect, useMemo } from "react";
import { cloneMarkets } from "./marketStorage.js";
import { apiUrl } from "../../utils/api.js";
import { MARKET_CACHE_KEY } from "../preferences/storageKeys.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useMarketData() {
  const [markets, setMarkets] = useState(cloneMarkets);

  const [marketDataStatus, setMarketDataStatus] = useState({ connected: false, cachedSymbols: 0, updatedAt: null });

  const [marketIndices, setMarketIndices] = useState([]);

  useEffect(() => {
    let active = true;
    let timer;
    const loadIndices = async () => {
      try {
        const response = await fetch(apiUrl("/api/indices"));
        if (!response.ok) throw new Error("시장 지수 요청 실패");
        const payload = await response.json();
        if (active && Array.isArray(payload.items) && payload.items.length) setMarketIndices(payload.items);
      } catch {
        // 일시적인 외부 장애에는 직전 정상값을 그대로 유지한다.
      } finally {
        if (active) timer = window.setTimeout(loadIndices, 60_000);
      }
    };
    loadIndices();
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let active = true;
    let timer;
    const loadAlternativeQuotes = async () => {
      try {
        const response = await fetch(apiUrl("/api/alternative-quotes"));
        if (!response.ok) throw new Error("대체시장 시세 요청 실패");
        const payload = await response.json();
        if (!active) return;
        setMarkets((current) => {
          const next = { ...current };
          for (const categoryKey of ["futures", "bonds", "crypto"]) {
            const quoteMap = new Map((payload.items?.[categoryKey] || []).map((quote) => [quote.symbol, quote]));
            next[categoryKey] = current[categoryKey].map((asset) => {
              const quote = quoteMap.get(asset.symbol);
              return quote && Number.isFinite(quote.price) ? { ...asset, ...quote } : asset;
            });
          }
          return next;
        });
      } catch {
        // 외부 제공처 장애 시 마지막 정상값 또는 초기 기준값을 유지한다.
      } finally {
        if (active) timer = window.setTimeout(loadAlternativeQuotes, 30_000);
      }
    };
    loadAlternativeQuotes();
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMarkets((prev) => {
        const next = JSON.parse(JSON.stringify(prev));

        Object.entries(next).forEach(([type, list]) => {
          list.forEach((asset) => {
            if (asset.synthetic) return;
            if (type === "stocks" && asset.priceSource?.startsWith("KIS")) return;
            if (asset.isReal) return;
            if (type === "bonds") {
              const dy = (Math.random() - 0.5) * 0.018;
              asset.yield = Math.max(0.1, asset.yield + dy);
              asset.price = Math.max(1000, asset.price * (1 - (asset.duration * dy) / 100));
              asset.change = dy;
            } else {
              const vol = type === "crypto" ? 0.008 : type === "futures" ? 0.0035 : 0.0025;
              const move = (Math.random() - 0.5) * 2 * vol;
              asset.price = Math.max(0.0001, asset.price * (1 + move));
              asset.change = move * 100;
            }
          });
        });

        const samsung = next.stocks.find((asset) => asset.id === "005930");
        const hynix = next.stocks.find((asset) => asset.id === "000660");
        const synthetic = next.stocks.find((asset) => asset.id === "SH10X");
        if (synthetic && samsung && hynix) {
          const leveragedChange = Math.max(-99, Math.min(99, ((samsung.change + hynix.change) / 2) * 10));
          synthetic.price = Math.max(100, 10000 * (1 + leveragedChange / 100));
          synthetic.change = leveragedChange;
          synthetic.open = 10000;
          synthetic.high = Math.max(10000, synthetic.price);
          synthetic.low = Math.min(10000, synthetic.price);
          synthetic.volume = Math.round(((samsung.volume || 0) + (hynix.volume || 0)) / 2);
          synthetic.priceSource = "삼성전자·SK하이닉스 동일비중 10배 합성";
        }

        return next;
      });
    }, 1500);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    // 서버 저장값을 먼저 받고, KIS 값이 갱신되면 다음 2초 폴링에서 화면에 반영한다.
    const loadQuotes = async () => {
      try {
        const response = await fetch(apiUrl("/api/quotes"));
        if (!response.ok) throw new Error(`시세 API 오류 (${response.status})`);
        const data = await response.json();
        if (!active) return;

        const quotes = Array.isArray(data.items) ? data.items : [];
        if (quotes.length > 0) {
          const quoteMap = new Map(quotes.map((quote) => [quote.symbol, quote]));
          setMarkets((prev) => ({
            ...prev,
            stocks: (() => {
              const updated = prev.stocks.map((asset) => {
              const quote = quoteMap.get(asset.symbol);
              if (!quote || !Number.isFinite(quote.price)) return asset;
              return {
                ...asset,
                price: quote.price,
                changeAmount: Number.isFinite(quote.changeAmount) ? quote.changeAmount : asset.changeAmount,
                change: Number.isFinite(quote.change) ? quote.change : asset.change,
                open: quote.open,
                high: quote.high,
                low: quote.low,
                volume: quote.volume,
                priceSource: quote.source,
                priceUpdatedAt: quote.updatedAt,
              };
              });
              const samsung = updated.find((asset) => asset.id === "005930");
              const hynix = updated.find((asset) => asset.id === "000660");
              const leveragedChange = Math.max(-99, Math.min(99, (((samsung?.change || 0) + (hynix?.change || 0)) / 2) * 10));
              return updated.map((asset) => asset.id === "SH10X" ? {
                ...asset,
                price: Math.max(100, 10000 * (1 + leveragedChange / 100)),
                changeAmount: Math.max(100, 10000 * (1 + leveragedChange / 100)) - 10000,
                change: leveragedChange,
                open: 10000,
                high: Math.max(10000, 10000 * (1 + leveragedChange / 100)),
                low: Math.min(10000, Math.max(100, 10000 * (1 + leveragedChange / 100))),
                volume: Math.round(((samsung?.volume || 0) + (hynix?.volume || 0)) / 2),
                priceSource: "삼성전자·SK하이닉스 동일비중 10배 합성",
                priceUpdatedAt: new Date().toISOString(),
              } : asset);
            })(),
          }));
          // 다음 접속에서도 즉시 표시할 수 있도록 정상 응답을 브라우저에 저장한다.
          window.localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(quotes.map((quote) => ({
            symbol: quote.symbol,
            price: quote.price,
            changeAmount: quote.changeAmount,
            change: quote.change,
            open: quote.open,
            high: quote.high,
            low: quote.low,
            volume: quote.volume,
            priceSource: quote.source,
            priceUpdatedAt: quote.updatedAt,
          }))));
        }

        setMarketDataStatus({
          connected: Boolean(data.status?.ok) && quotes.length > 0,
          cachedSymbols: data.status?.cachedSymbols ?? quotes.length,
          updatedAt: quotes.map((quote) => quote.updatedAt).filter(Boolean).sort().at(-1) ?? null,
        });
      } catch {
        if (active) setMarketDataStatus((prev) => ({ ...prev, connected: false }));
      }
    };

    loadQuotes();
    const timer = window.setInterval(loadQuotes, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const allAssets = useMemo(() => Object.values(markets).flat(), [markets]);

  return {
    markets, setMarkets, marketDataStatus, marketIndices, allAssets,
  };
}
