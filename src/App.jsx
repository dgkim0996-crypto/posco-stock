import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { INITIAL_MARKETS } from "./data/markets.js";
import MarketList from "./components/MarketList.jsx";
import Sparkline from "./components/Sparkline.jsx";
import AssetLogo from "./components/AssetLogo.jsx";
import StockFundamentals from "./components/StockFundamentals.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import PasswordRecovery from "./components/PasswordRecovery.jsx";
import poscoLogo from "./assets/posco-ci-blue.png";
import { assetMatchesSearch } from "./utils/assetSearch.js";
import { apiFetch } from "./utils/api.js";
import { supabase } from "./lib/supabase.js";

const AssetOverview = lazy(() => import("./pages/AssetOverview.jsx"));
const InvestmentInfo = lazy(() => import("./pages/InvestmentInfo.jsx"));
const Products = lazy(() => import("./pages/Products.jsx"));
const Banking = lazy(() => import("./pages/Banking.jsx"));
const MarketSummary = lazy(() => import("./pages/MarketSummary.jsx"));
const Operations = lazy(() => import("./pages/Operations.jsx"));

// 애플리케이션의 중앙 상태 관리자이자 화면 조립 컴포넌트다.
// 초기값/브라우저 저장값 복원 → 서버 시세·차트 동기화 → 주문/자산 계산 → 현재 메뉴 렌더링 순으로 동작한다.

const STARTING_CASH = 10000000;
const USD_KRW = 1380;
const LABELS = {
  stocks: "국내·해외주식",
  futures: "선물옵션",
  bonds: "채권",
  crypto: "디지털자산",
};

const DASHBOARD_STORAGE_KEY = "posco-dashboard-layout-v2";
const LEGACY_DASHBOARD_STORAGE_KEY = "posco-dashboard-layout-v1";
// 서버 응답을 브라우저에도 보관해 새로고침 직후 네트워크보다 먼저 표시한다.
const MARKET_CACHE_KEY = "posco-market-data-v1";
const CHART_CACHE_KEY = "posco-chart-data-v1";
const LEGACY_FAVORITES_STORAGE_KEY = "posco-market-favorites-v1";
const FAVORITES_MIGRATION_KEY = "posco-market-favorites-migrated-v2";
const THEME_STORAGE_KEY = "posco-color-theme-v1";
const DEFAULT_DASHBOARD_WIDGETS = [
  { id: "holdings", cols: 6, height: 370, collapsed: false, hidden: false },
  { id: "futures", cols: 6, height: 370, collapsed: false, hidden: false },
  { id: "history", cols: 12, height: 330, collapsed: false, hidden: false },
];
const DASHBOARD_META = {
  holdings: { eyebrow: "잔고", title: "보유상품", description: "평가손익 포함" },
  futures: { eyebrow: "선물옵션", title: "미결제약정", description: "보유 포지션" },
  history: { eyebrow: "거래", title: "당일 체결내역", description: "최근 40건" },
};

// 사용자가 편집한 MY 투자 위젯 순서·크기를 복원하고 누락/잘못된 값은 기본값으로 보정한다.
function loadDashboardWidgets() {
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

function cloneMarkets() {
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

// 기간별 차트를 복원해 1분·5분·일봉 전환 시 저장 데이터를 즉시 보여준다.
function loadChartCache() {
  if (typeof window === "undefined") return {};
  try {
    const saved = JSON.parse(window.localStorage.getItem(CHART_CACHE_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function favoritesStorageKey(userId) {
  return `posco-market-favorites-v2:${userId}`;
}

function loadFavorites(userId) {
  if (typeof window === "undefined") return new Set();
  try {
    const scoped = window.localStorage.getItem(favoritesStorageKey(userId));
    const legacy = !scoped && !window.localStorage.getItem(FAVORITES_MIGRATION_KEY)
      ? window.localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY)
      : null;
    const saved = JSON.parse(scoped || legacy || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function loadTheme() {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// KIS를 사용하지 않는 선물·채권·디지털자산 차트의 초기 모의 가격 흐름을 생성한다.
function seedChartValues(price, count = 72) {
  const start = price * (1 + (Math.random() - 0.5) * 0.018);
  const values = [Math.max(0.0001, start)];
  for (let i = 1; i < count - 1; i += 1) {
    const prev = values[i - 1];
    const drift = (price - prev) * 0.055;
    const noise = price * (Math.random() - 0.5) * 0.0045;
    values.push(Math.max(0.0001, prev + drift + noise));
  }
  values.push(price);
  return values;
}

// 두 기초종목의 같은 시각 OHLCV를 동일비중 10배 수익률로 합성한다.
// 마지막 종가는 현재 합성 ETF 가격과 맞춰 시세 요약과 차트가 서로 어긋나지 않게 한다.
function buildSyntheticCandles(leftCandles, rightCandles, currentPrice, leverage = 10) {
  const left = Array.isArray(leftCandles) ? leftCandles : [];
  const right = Array.isArray(rightCandles) ? rightCandles : [];
  const rightByTime = new Map(right.map((item) => [item.time, item]));
  let pairs = left.flatMap((item) => rightByTime.has(item.time) ? [[item, rightByTime.get(item.time)]] : []);

  // 제공처가 시각을 조금 다르게 반환한 경우에는 최신 봉끼리 순서대로 결합한다.
  if (pairs.length < 2) {
    const count = Math.min(left.length, right.length);
    pairs = Array.from({ length: count }, (_, index) => [left[left.length - count + index], right[right.length - count + index]]);
  }
  if (pairs.length < 2) return [];

  let previousLeft = Number(pairs[0][0].open) || Number(pairs[0][0].close);
  let previousRight = Number(pairs[0][1].open) || Number(pairs[0][1].close);
  let previousSynthetic = 10_000;
  const factor = (leftValue, rightValue) => Math.max(0.01, 1 + leverage * (
    ((Number(leftValue) / previousLeft) - 1 + (Number(rightValue) / previousRight) - 1) / 2
  ));

  const candles = pairs.map(([leftItem, rightItem]) => {
    const open = previousSynthetic * factor(leftItem.open, rightItem.open);
    const close = previousSynthetic * factor(leftItem.close, rightItem.close);
    const rawHigh = previousSynthetic * factor(leftItem.high, rightItem.high);
    const rawLow = previousSynthetic * factor(leftItem.low, rightItem.low);
    const item = {
      time: leftItem.time,
      open,
      high: Math.max(open, close, rawHigh, rawLow),
      low: Math.min(open, close, rawHigh, rawLow),
      close,
      volume: Math.round(((Number(leftItem.volume) || 0) + (Number(rightItem.volume) || 0)) / 2),
    };
    previousLeft = Number(leftItem.close) || previousLeft;
    previousRight = Number(rightItem.close) || previousRight;
    previousSynthetic = Math.max(100, close);
    return item;
  });

  const lastClose = candles.at(-1)?.close;
  const scale = Number.isFinite(currentPrice) && Number.isFinite(lastClose) && lastClose > 0 ? currentPrice / lastClose : 1;
  return candles.map((item) => ({
    ...item,
    open: Math.max(100, item.open * scale),
    high: Math.max(100, item.high * scale),
    low: Math.max(100, item.low * scale),
    close: Math.max(100, item.close * scale),
  }));
}

// 원화 금액의 부호와 천 단위 구분을 공통 형식으로 출력한다.
function money(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.round(value)).toLocaleString()}원`;
}

// 상품별 단위(지수·달러·원화)에 맞는 현재가 표시 문자열을 만든다.
function assetPrice(asset) {
  if (asset.unit === "PTS") {
    return asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (asset.unit === "USD") {
    return `$${asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(asset.price).toLocaleString()}원`;
}

function signedPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

// 전체 자산 합산을 위해 달러 상품 가격을 고정 환율 기준 원화로 환산한다.
function spotPriceInKRW(asset) {
  if (!asset) return 0;
  return asset.unit === "USD" ? asset.price * USD_KRW : asset.price;
}

function TradingApp({ session, onSignOut }) {
  // 거래·계좌·화면 편집에 필요한 상태를 한곳에서 관리하고 하위 페이지에는 필요한 값과 변경 함수를 전달한다.
  const [markets, setMarkets] = useState(cloneMarkets);
  const [mainTab, setMainTab] = useState("trading");
  const [foreignCash, setForeignCash] = useState(0);
  const [category, setCategory] = useState("stocks");
  const [selectedId, setSelectedId] = useState(INITIAL_MARKETS.stocks[0].id);
  const [cash, setCash] = useState(STARTING_CASH);
  const [accountNumber, setAccountNumber] = useState("계좌 준비 중");
  const [financeAccount, setFinanceAccount] = useState({
    credit: { active: false, limit: 0, debt: 0 },
    margin: { active: false, limit: 0, debt: 0 },
    lending: { active: false, limit: 0, locked: 0 },
    collateral: { active: false, limit: 0, debt: 0 },
  });
  const [spotPositions, setSpotPositions] = useState({});
  const [shortPositions, setShortPositions] = useState({});
  const [futuresPositions, setFuturesPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [orderTab, setOrderTab] = useState("order");
  const [orderType, setOrderType] = useState("MARKET");
  const [limitPrice, setLimitPrice] = useState("");
  const [pendingOrders, setPendingOrders] = useState([]);
  const [filledOrders, setFilledOrders] = useState([]);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [orderEvents, setOrderEvents] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [quantity, setQuantity] = useState("1");
  const [chartData, setChartData] = useState(loadChartCache);
  const [chartPeriod, setChartPeriod] = useState("1m");
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState("");
  const [message, setMessage] = useState("포스코증권 모의투자 계좌가 준비되었습니다.");
  const [dashboardWidgets, setDashboardWidgets] = useState(loadDashboardWidgets);
  const [editDashboard, setEditDashboard] = useState(false);
  const [draggingWidget, setDraggingWidget] = useState(null);
  const [dragOverWidget, setDragOverWidget] = useState(null);
  const [resizingWidget, setResizingWidget] = useState(null);
  const [marketDataStatus, setMarketDataStatus] = useState({ connected: false, cachedSymbols: 0, updatedAt: null });
  const [realtimeStatus, setRealtimeStatus] = useState({ connected: false, updatedAt: null });
  const [orderBook, setOrderBook] = useState(null);
  const [riskStatus, setRiskStatus] = useState(null);
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState("");
  const [marketIndices, setMarketIndices] = useState([]);
  const [favorites, setFavorites] = useState(() => loadFavorites(session.user.id));
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // 자산 탭에서는 삭제되지 않는 감사 원장을 서버 원본으로 조회한다.
  useEffect(() => {
    if (mainTab !== "assets") return undefined;
    let active = true;
    apiFetch("/api/accounts/me/ledger?limit=100")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "계좌 원장 조회 실패");
        if (active) setLedgerEntries(Array.isArray(payload.items) ? payload.items : []);
      })
      .catch(() => undefined);
    apiFetch("/api/accounts/me/order-events?limit=200").then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "주문 이벤트 조회 실패");
      if (active) setOrderEvents(Array.isArray(payload.items) ? payload.items : []);
    }).catch(() => undefined);
    apiFetch("/api/accounts/me/settlements").then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "결제 예정내역 조회 실패");
      if (active) setSettlements(Array.isArray(payload.items) ? payload.items : []);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [mainTab]);

  // 계좌의 영속 상태를 Supabase 기반 통합 API에서 복원한다.
  useEffect(() => {
    let active = true;
    apiFetch("/api/accounts/me/state").then(async(response)=>{
      const payload=await response.json(); if(!response.ok)throw new Error(payload.error||"계좌 상태 조회 실패"); return payload;
    }).then((state)=>{
      if(!active)return;
      setAccountNumber(state.account.accountNumber); setCash(state.account.krwBalance); setForeignCash(state.account.usdBalance); setFinanceAccount(state.finance);
      setSpotPositions(Object.fromEntries(state.holdings.map((item)=>[item.symbol,{quantity:item.quantity,avgPrice:item.avgPrice,type:item.category}])));
      setShortPositions(Object.fromEntries(state.shortPositions.map((item)=>[item.symbol,{quantity:item.quantity,avgPrice:item.avgPrice}])));
      setFuturesPositions(state.futuresPositions.map((item)=>{const asset=INITIAL_MARKETS.futures.find((candidate)=>candidate.symbol===item.symbol);return{...item,assetId:item.symbol,name:asset?.name||item.symbol};}));
      setFilledOrders(state.orders.filter((order)=>order.status==="FILLED").map((order)=>{const asset=Object.values(INITIAL_MARKETS).flat().find((candidate)=>candidate.symbol===order.symbol);return{...order,assetId:order.symbol,name:asset?.name||order.symbol,executionPrice:asset?.unit==="USD"?order.executionPrice/USD_KRW:order.executionPrice,filledAt:new Date(order.updatedAt||order.createdAt).toLocaleTimeString("ko-KR")};}));
      setPendingOrders(state.pendingOrders.map((order)=>{const asset=Object.values(INITIAL_MARKETS).flat().find((candidate)=>candidate.symbol===order.symbol);return{...order,pendingOrderId:order.id,assetId:order.symbol,name:asset?.name||order.symbol,orderType:"LIMIT",orderedAt:new Date(order.createdAt).toLocaleTimeString("ko-KR")};}));
    }).catch((error)=>{if(active)setMessage(`계좌 데이터 연결 실패 · ${error.message}`);});
    return()=>{active=false;};
  }, []);

  // 피드와 요약 화면이 동일한 실제 시장 지수를 사용하도록 서버 값을 한 번만 공유한다.
  useEffect(() => {
    let active = true;
    let timer;
    const loadIndices = async () => {
      try {
        const response = await fetch("/api/indices");
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

  // 선물·국채·디지털자산의 공개 실제 시세를 묶음으로 받아 모의 초기값을 교체한다.
  useEffect(() => {
    let active = true;
    let timer;
    const loadAlternativeQuotes = async () => {
      try {
        const response = await fetch("/api/alternative-quotes");
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

  const assets = markets[category];
  const selected = assets.find((a) => a.id === selectedId) ?? assets[0];

  // 선택한 국내주식만 KIS 실시간 체결가·10단계 호가를 구독하고 REST는 전체 종목 폴백으로 유지한다.
  useEffect(() => {
    setOrderBook(null);
    if (category !== "stocks" || selected?.unit !== "KRW" || selected?.market === "SIM") {
      setRealtimeStatus({ connected: false, updatedAt: null });
      return undefined;
    }
    let active = true;
    let reconnectTimer;
    let socket;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/market`);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "subscribe", symbol: selected.symbol })));
      socket.addEventListener("message", (event) => {
        if (!active) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "status") setRealtimeStatus((current) => ({ ...current, connected: Boolean(message.data?.connected) }));
          if (message.type === "quote" && message.data?.symbol === selected.symbol) {
            const quote = message.data;
            setMarkets((current) => ({ ...current, stocks: current.stocks.map((asset) => asset.symbol === quote.symbol ? {
              ...asset, price: quote.price, change: quote.change ?? asset.change, open: quote.open ?? asset.open,
              high: quote.high ?? asset.high, low: quote.low ?? asset.low, volume: quote.volume ?? asset.volume,
              priceSource: "KIS WebSocket", priceUpdatedAt: quote.updatedAt,
            } : asset) }));
            setRealtimeStatus({ connected: true, updatedAt: quote.updatedAt });
          }
          if (message.type === "orderbook" && message.data?.symbol === selected.symbol) setOrderBook(message.data);
        } catch { /* 손상된 한 프레임은 버리고 다음 실시간 데이터 수신을 계속한다. */ }
      });
      socket.addEventListener("close", () => {
        if (!active) return;
        setRealtimeStatus((current) => ({ ...current, connected: false }));
        reconnectTimer = window.setTimeout(connect, 2000);
      });
    };
    connect();
    return () => {
      active = false;
      window.clearTimeout(reconnectTimer);
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "unsubscribe", symbol: selected.symbol }));
      socket?.close();
    };
  }, [category, selected?.symbol, selected?.unit, selected?.market]);

  // 계좌 위험도를 주기적으로 재평가하고 청산 임계값 도달 시 서버의 원자적 강제청산 결과를 반영한다.
  useEffect(() => {
    let active=true;let timer;
    const loadRisk=async()=>{try{const response=await apiFetch("/api/accounts/me/risk");const payload=await response.json();if(!response.ok)throw new Error(payload.error||"위험 평가 실패");if(!active)return;setRiskStatus(payload);if(payload.liquidations?.length){setCash(payload.account.krwBalance);setFuturesPositions(payload.futuresPositions.map((item)=>{const asset=INITIAL_MARKETS.futures.find((candidate)=>candidate.symbol===item.symbol);return{...item,assetId:item.symbol,name:asset?.name||item.symbol};}));setMessage(`${payload.liquidations.length}개 선물 포지션이 유지증거금 미달로 강제청산됐습니다.`);}}catch{}finally{if(active)timer=window.setTimeout(loadRisk,10000);}};
    loadRisk();return()=>{active=false;window.clearTimeout(timer);};
  }, []);

  // 상품군을 바꾸면 해당 목록에 존재하는 종목을 선택하고 주문 입력값을 초기화한다.
  useEffect(() => {
    const list = INITIAL_MARKETS[category];
    setSelectedId((prev) => list.some((item) => item.id === prev) ? prev : list[0].id);
    setQuantity(category === "crypto" ? "0.01" : "1");
    setOrderType("MARKET");
    setLimitPrice("");
  }, [category]);

  // 지정가 주문을 선택할 때 현재 선택 종목 가격을 최초 지정가로 채운다.
  useEffect(() => {
    if (orderType === "LIMIT") setLimitPrice(String(Number(selected.price.toFixed(2))));
  }, [selected.id]);

  // KIS 실제시세가 아닌 상품만 1.5초마다 작은 폭으로 움직여 모의 시장을 표현한다.
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

  // 서버의 전체 시세를 2초마다 받아 주식 목록과 연결 상태를 최신 값으로 유지한다.
  useEffect(() => {
    let active = true;

    // 서버 저장값을 먼저 받고, KIS 값이 갱신되면 다음 2초 폴링에서 화면에 반영한다.
    const loadQuotes = async () => {
      try {
        const response = await fetch("/api/quotes");
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

  // 모의상품 가격이 변할 때 해당 상품의 단순 가격 차트에 새 점을 추가한다.
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

  // 선택한 상품의 기간별 실제 OHLCV를 불러오고 기간에 맞는 간격으로 다시 조회한다.
  useEffect(() => {
    let active = true;
    let timer;
    const key = `${selected.symbol}:${chartPeriod}`;
    const normalRefreshMs = chartPeriod === "day" ? 300_000 : 60_000;

    const requestChart = async (period) => {
      if (selected.synthetic) {
        const componentSymbols = selected.components || ["005930", "000660"];
        const responses = await Promise.all(componentSymbols.map((symbol) => (
          fetch(`/api/charts/${encodeURIComponent(symbol)}?period=${period}`)
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

      const chartUrl = category === "stocks"
        ? `/api/charts/${encodeURIComponent(selected.symbol)}?period=${period}`
        : `/api/alternative-charts/${category}/${encodeURIComponent(selected.symbol)}?period=${period}`;
      const response = await fetch(chartUrl);
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.error || `차트 API 오류 (${response.status})`);
        error.retryAfter = Number(payload.retryAfter) || Number(response.headers.get("Retry-After")) || 0;
        throw error;
      }
      return payload;
    };

    // 현재 기간을 요청하고 성공하면 React 상태와 브라우저 캐시를 함께 갱신한다.
    const loadChart = async () => {
      let nextRefreshMs = normalRefreshMs;
      setChartLoading(true);
      try {
        const data = await requestChart(chartPeriod);
        if (!Array.isArray(data.candles) || data.candles.length < 2) throw new Error("합성할 수 있는 기초종목 차트 데이터가 부족합니다.");
        if (!active) return;
        setChartData((prev) => {
          // 이후 기간 전환과 새로고침에서 재사용할 실제 봉 데이터다.
          const next = { ...prev, [key]: data.candles || [] };
          window.localStorage.setItem(CHART_CACHE_KEY, JSON.stringify(next));
          return next;
        });
        setChartError("");

        // 기본 1분봉이 뜬 직후 다른 기간도 조용히 준비해 탭 전환 대기를 없앤다.
        if (chartPeriod === "1m") {
          for (const period of ["5m", "30m", "60m", "day"]) {
            const preloadKey = `${selected.symbol}:${period}`;
            requestChart(period)
              .then((preloadData) => {
                if (!active || !Array.isArray(preloadData?.candles) || !preloadData.candles.length) return;
                setChartData((prev) => {
                  const next = { ...prev, [preloadKey]: preloadData.candles };
                  window.localStorage.setItem(CHART_CACHE_KEY, JSON.stringify(next));
                  return next;
                });
              })
              .catch(() => undefined);
          }
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
    };
  }, [category, selected.symbol, chartPeriod]);

  // MY 투자 위젯 편집 결과를 변경 즉시 브라우저에 저장한다.
  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(dashboardWidgets));
  }, [dashboardWidgets]);

  useEffect(() => {
    window.localStorage.setItem(favoritesStorageKey(session.user.id), JSON.stringify([...favorites]));
    window.localStorage.setItem(FAVORITES_MIGRATION_KEY, "true");
  }, [favorites, session.user.id]);

  // Supabase에 저장된 관심 종목을 불러오고, 최초 연결 시 기존 브라우저 값을 한 번 이관한다.
  useEffect(() => {
    let active = true;

    const loadRemoteFavorites = async () => {
      try {
        const response = await apiFetch("/api/accounts/me/favorites");
        if (!response.ok) throw new Error("즐겨찾기 조회 실패");
        const payload = await response.json();
        if (!active || !Array.isArray(payload.items)) return;

        if (payload.items.length === 0) {
          const localFavorites = [...loadFavorites(session.user.id)];
          if (localFavorites.length > 0) {
            await Promise.all(localFavorites.map((symbol) => apiFetch(
              "/api/accounts/me/favorites",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbol }),
              },
            ).then((result) => {
              if (!result.ok) throw new Error("기존 즐겨찾기 이전 실패");
            })));
          }
          return;
        }

        setFavorites(new Set(payload.items));
      } catch {
        // DB가 일시적으로 응답하지 않으면 브라우저에 저장된 마지막 값으로 계속 동작한다.
      }
    };

    loadRemoteFavorites();
    return () => { active = false; };
  }, [session.user.id]);

  function toggleFavorite(assetId) {
    const removing = favorites.has(assetId);
    const next = new Set(favorites);
    if (removing) next.delete(assetId);
    else next.add(assetId);
    setFavorites(next);

    apiFetch(`/api/accounts/me/favorites${removing ? `/${encodeURIComponent(assetId)}` : ""}`, {
      method: removing ? "DELETE" : "POST",
      headers: removing ? undefined : { "Content-Type": "application/json" },
      body: removing ? undefined : JSON.stringify({ symbol: assetId }),
    }).then((response) => {
      if (!response.ok) throw new Error("즐겨찾기 동기화 실패");
    }).catch(() => {
      setMessage("즐겨찾기는 브라우저에 저장했지만 서버 동기화에 실패했습니다.");
    });
  }

  // 여러 상품군 배열을 주문 및 자산 계산에서 검색하기 쉬운 단일 배열로 합친다.
  const allAssets = useMemo(() => Object.values(markets).flat(), [markets]);

  // 상단 통합검색은 모든 상품군에서 종목명·코드를 찾아 최대 8개 결과를 보여준다.
  const headerSearchResults = useMemo(() => {
    if (!headerSearchQuery.trim()) return [];
    return Object.entries(markets).flatMap(([assetCategory, list]) => list.map((asset) => ({
      asset,
      category: assetCategory,
    }))).filter(({ asset }) => assetMatchesSearch(asset, headerSearchQuery)).slice(0, 8);
  }, [markets, headerSearchQuery]);

  // 대기 중인 지정가 주문이 현재가 조건을 만족하면 자동 체결하고 대기 목록에서 제거한다.
  useEffect(() => {
    const order = pendingOrders.find((item) => !item.processing && (!item.nextMatchAt || item.nextMatchAt <= Date.now()) && (() => {
      const asset = allAssets.find((candidate) => candidate.id === item.assetId);
      if (!asset) return false;
      return item.side === "BUY" ? asset.price <= item.limitPrice : asset.price >= item.limitPrice;
    })());
    if (!order) return;

    const matchedAsset = allAssets.find((item) => item.id === order.assetId);
    if (!matchedAsset) return;
    setPendingOrders((prev)=>prev.map((item)=>item.id===order.id?{...item,processing:true}:item));
    const fillQuantity = order.category === "crypto"
      ? Math.min(order.quantity, Math.max(0.000001, Number((order.quantity / 2).toFixed(6))))
      : Math.min(order.quantity, Math.max(1, Math.ceil(order.quantity / 2)));
    executeSpotOrder(order, matchedAsset.price, fillQuantity).then((result)=>{
      setPendingOrders((prev)=>result?.completed
        ? prev.filter((item)=>item.id!==order.id)
        : prev.map((item)=>item.id===order.id
          ? {...item,quantity:result?.remainingQuantity ?? item.quantity,processing:false,nextMatchAt:Date.now()+3000}
          : item));
    });
  }, [allAssets, pendingOrders]);

  // 현물 보유수량에 최신 원화환산 가격을 곱해 총 평가액을 계산한다.
  const spotValue = useMemo(() => {
    return Object.entries(spotPositions).reduce((sum, [id, pos]) => {
      const asset = allAssets.find((x) => x.id === id);
      return sum + (asset ? spotPriceInKRW(asset) * pos.quantity : 0);
    }, 0);
  }, [spotPositions, allAssets]);

  // 현물 포지션의 평균단가와 수량으로 총 매입원금을 계산한다.
  const spotCost = useMemo(() => {
    return Object.values(spotPositions).reduce(
      (sum, pos) => sum + pos.avgPrice * pos.quantity,
      0,
    );
  }, [spotPositions]);

  // 선물 진입가 대비 현재가 차이에 방향과 승수를 적용해 미실현 손익을 계산한다.
  const futuresPnl = useMemo(() => {
    return futuresPositions.reduce((sum, pos) => {
      const asset = markets.futures.find((x) => x.id === pos.assetId);
      if (!asset) return sum;
      const direction = pos.side === "LONG" ? 1 : -1;
      return sum + (asset.price - pos.entryPrice) * asset.multiplier * pos.quantity * direction;
    }, 0);
  }, [futuresPositions, markets]);

  // 열린 선물 포지션에 묶인 증거금 합계다.
  const marginTotal = useMemo(
    () => futuresPositions.reduce((sum, pos) => sum + pos.margin, 0),
    [futuresPositions],
  );

  const lendingUsed = useMemo(() => Object.entries(shortPositions).reduce((sum, [id, pos]) => {
    const asset = allAssets.find((item) => item.id === id);
    return sum + (asset ? spotPriceInKRW(asset) * pos.quantity : 0);
  }, 0), [shortPositions, allAssets]);
  const lendingPnl = useMemo(() => Object.entries(shortPositions).reduce((sum, [id, pos]) => {
    const asset = allAssets.find((item) => item.id === id);
    return sum + (asset ? (pos.avgPrice - spotPriceInKRW(asset)) * pos.quantity : 0);
  }, 0), [shortPositions, allAssets]);

  const financeDebt = financeAccount.credit.debt + financeAccount.margin.debt + financeAccount.collateral.debt;
  const lendingCollateral = financeAccount.lending.locked;
  const totalAssets = cash + foreignCash * USD_KRW + spotValue + marginTotal + futuresPnl + lendingCollateral - financeDebt - lendingUsed;
  const totalPnl = spotValue - spotCost + futuresPnl + lendingPnl;
  const totalReturn = spotCost > 0 ? ((spotValue - spotCost + futuresPnl) / spotCost) * 100 : 0;

  const bestAsk = orderBook?.symbol === selected.symbol && Number.isFinite(orderBook.asks?.[0]?.price) ? orderBook.asks[0].price : selected.price * 1.001;
  const bestBid = orderBook?.symbol === selected.symbol && Number.isFinite(orderBook.bids?.[0]?.price) ? orderBook.bids[0].price : selected.price * 0.999;

  // 현재 현금과 주문가격을 기준으로 매수 가능한 최대 수량(선물은 최대 계약수)을 입력한다.
  function setMaximumOrderQuantity() {
    if (category === "futures") {
      const marginPerContract = selected.price * selected.multiplier * selected.marginRate;
      const maximum = marginPerContract > 0 ? Math.floor(cash / marginPerContract) : 0;
      setQuantity(String(maximum));
      setMessage(maximum > 0 ? `주문가능금액 기준 최대 ${maximum}계약입니다.` : "현재 현금으로 주문 가능한 계약이 없습니다.");
      return;
    }

    const requestedPrice = orderType === "LIMIT" ? Number(limitPrice) : selected.price;
    if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
      setMessage("최대 수량을 계산하려면 주문가격을 먼저 입력해 주세요.");
      return;
    }

    const reservedBuyAmount = pendingOrders
      .filter((item) => item.side === "BUY")
      .reduce((sum, item) => {
        const asset = allAssets.find((candidate) => candidate.id === item.assetId);
        return sum + (asset ? spotPriceInKRW({ ...asset, price: item.limitPrice }) * item.quantity : 0);
      }, 0);
    const availableCash = Math.max(0, cash - reservedBuyAmount);
    const unitPrice = spotPriceInKRW({ ...selected, price: requestedPrice });
    const maximum = category === "crypto"
      ? Math.floor((availableCash / unitPrice) * 1000000) / 1000000
      : Math.floor(availableCash / unitPrice);

    setQuantity(String(maximum));
    setMessage(maximum > 0 ? `주문가능금액 기준 최대 수량은 ${maximum.toLocaleString()}입니다.` : "현재 현금으로 주문 가능한 수량이 없습니다.");
  }

  // 사용자에게 보여줄 체결 메시지와 최근 거래내역을 동시에 추가한다.
  function pushTrade(text) {
    setTrades((prev) => [
      { id: crypto.randomUUID(), time: new Date().toLocaleTimeString("ko-KR"), text },
      ...prev,
    ].slice(0, 40));
  }

  // 체결된 주문에 실제 체결가·시각을 붙여 체결 탭의 최신순 목록에 저장한다.
  function addFilledOrder(order, executionPrice) {
    setFilledOrders((prev) => [{
      ...order,
      status: "FILLED",
      executionPrice,
      filledAt: new Date().toLocaleTimeString("ko-KR"),
    }, ...prev].slice(0, 40));
  }

  // 현물 매수/매도의 잔고 검증, 현금 변경, 평균단가·보유수량 갱신을 한 번에 처리한다.
  async function executeSpotOrder(order, executionPrice, fillQuantity = null) {
    const asset = allAssets.find((item) => item.id === order.assetId);
    if (!asset) return false;
    try {
      const response=await apiFetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:order.symbol,side:order.side,quantity:order.quantity,orderType:order.orderType,requestedPrice:order.limitPrice,pendingOrderId:order.pendingOrderId||null,fillQuantity})});
      const result=await response.json(); if(!response.ok)throw new Error(result.error||"주문 처리 실패");
      setCash(result.account.krwBalance);
      setSpotPositions((prev)=>{const next={...prev};if(result.holding)next[asset.id]={quantity:result.holding.quantity,avgPrice:result.holding.avgPrice,type:result.holding.category};else delete next[asset.id];return next;});
      setShortPositions((prev)=>{const next={...prev};if(result.shortPosition)next[asset.id]={quantity:result.shortPosition.quantity,avgPrice:result.shortPosition.avgPrice};else delete next[asset.id];return next;});
      const nativeExecutionPrice=asset.unit==="USD"?result.order.price/USD_KRW:result.order.price;
      const completed=result.order.status==="FILLED";
      const executedQuantity=fillQuantity ?? order.quantity;
      if(completed)addFilledOrder({...order,id:result.order.id,quantity:result.order.filledQuantity},nativeExecutionPrice);
      pushTrade(`${LABELS[order.category]} · ${asset.name} ${executedQuantity} ${order.side==="BUY"?"매수":"매도"} · ${assetPrice({...asset,price:nativeExecutionPrice})}`);
      setMessage(completed
        ? `${asset.name} ${result.order.filledQuantity} ${order.side==="BUY"?"매수":"매도"} 전량 체결`
        : `${asset.name} ${executedQuantity} 부분체결 · 잔여 ${result.order.remainingQuantity}`);
      return {completed,remainingQuantity:result.order.remainingQuantity};
    } catch(error) { setMessage(`${asset.name} 주문 실패 · ${error.message}`); return null; }
  }

  // 주문 입력을 검증하고 시장가는 즉시 체결, 지정가는 조건에 따라 체결 또는 대기시킨다.
  async function placeSpotOrder(side) {
    const qty = Number(quantity);
    const requestedPrice = orderType === "LIMIT" ? Number(limitPrice) : selected.price;
    if (!Number.isFinite(qty) || qty <= 0) {
      setMessage("주문 수량을 0보다 크게 입력해 주세요.");
      return;
    }
    if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
      setMessage("지정가를 0보다 크게 입력해 주세요.");
      return;
    }
    const reservedSellQuantity = pendingOrders
      .filter((item) => item.assetId === selected.id && item.side === "SELL")
      .reduce((sum, item) => sum + item.quantity, 0);
    if (side === "SELL") {
      const ownedQuantity = spotPositions[selected.id]?.quantity ?? 0;
      const shortQuantity = Math.max(0, reservedSellQuantity + qty - ownedQuantity);
      const shortAmount = spotPriceInKRW({ ...selected, price: requestedPrice }) * shortQuantity;
      if (shortQuantity > 0 && (category !== "stocks" || !financeAccount.lending.active)) {
        setMessage("보유수량 초과 매도에는 대주거래 실행이 필요합니다.");
        return;
      }
      if (shortQuantity > 0 && lendingUsed + shortAmount > financeAccount.lending.limit) {
        setMessage("미체결 주문을 포함한 대주매도 금액이 대주한도를 초과합니다.");
        return;
      }
    }

    const order = {
      id: crypto.randomUUID(),
      assetId: selected.id,
      symbol: selected.symbol,
      name: selected.name,
      category,
      side,
      orderType,
      quantity: qty,
      limitPrice: orderType === "LIMIT" ? requestedPrice : null,
      orderedAt: new Date().toLocaleTimeString("ko-KR"),
    };
    const crossesMarket = orderType === "MARKET"
      || (side === "BUY" ? requestedPrice >= selected.price : requestedPrice <= selected.price);

    if (crossesMarket) {
      executeSpotOrder(order, selected.price);
    } else {
      const estimatedAmount = spotPriceInKRW({ ...selected, price: requestedPrice }) * qty;
      const reservedBuyAmount = pendingOrders
        .filter((item) => item.side === "BUY")
        .reduce((sum, item) => {
          const asset = allAssets.find((candidate) => candidate.id === item.assetId);
          return sum + (asset ? spotPriceInKRW({ ...asset, price: item.limitPrice }) * item.quantity : 0);
        }, 0);
      if (side === "BUY" && estimatedAmount + reservedBuyAmount > cash) {
        setMessage("주문가능금액이 부족합니다.");
        return;
      }
      try {
        const response=await apiFetch("/api/accounts/me/pending-orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:selected.symbol,side,quantity:qty,limitPrice:requestedPrice})});
        const saved=await response.json();if(!response.ok)throw new Error(saved.error||"지정가 주문 저장 실패");
        setPendingOrders((prev)=>[{...order,id:saved.id,pendingOrderId:saved.id,orderId:saved.orderId||null,createdAt:saved.createdAt},...prev]);
        setMessage(`${selected.name} ${qty} ${side==="BUY"?"매수":"매도"} 지정가 주문 접수`);setOrderTab("pending");
      } catch(error){setMessage(`${selected.name} 지정가 주문 실패 · ${error.message}`);}
    }
  }

  // 주문 버튼에서 공통 주문 함수로 매수 방향을 전달한다.
  function buySpot() {
    placeSpotOrder("BUY");
  }

  // 주문 버튼에서 공통 주문 함수로 매도 방향을 전달한다.
  function sellSpot() {
    placeSpotOrder("SELL");
  }

  async function cancelPendingOrder(order) {
    try {
      const response=await apiFetch(`/api/accounts/me/pending-orders/${order.pendingOrderId||order.id}`,{method:"DELETE"});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"주문 취소 실패");
      setPendingOrders((prev)=>prev.filter((item)=>item.id!==order.id));setMessage(`${order.name} 지정가 주문을 취소했습니다.`);
    } catch(error){setMessage(`${order.name} 주문 취소 실패 · ${error.message}`);}
  }

  async function amendPendingOrder(order) {
    const nextQuantity = Number(window.prompt("정정 수량", String(order.quantity)));
    const nextLimitPrice = Number(window.prompt("정정 지정가", String(order.limitPrice)));
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0 || !Number.isFinite(nextLimitPrice) || nextLimitPrice <= 0) return;
    try {
      const response = await apiFetch(`/api/accounts/me/pending-orders/${order.pendingOrderId || order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: nextQuantity, limitPrice: nextLimitPrice }) });
      const saved = await response.json(); if (!response.ok) throw new Error(saved.error || "주문 정정 실패");
      setPendingOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, quantity: saved.quantity, limitPrice: saved.limitPrice } : item));
      setMessage(`${order.name} 지정가 주문을 정정했습니다.`);
    } catch (error) { setMessage(`${order.name} 주문 정정 실패 · ${error.message}`); }
  }

  // 증거금을 확인한 뒤 LONG/SHORT 선물 포지션을 새로 연다.
  async function openFuture(side) {
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty < 1) {
      setMessage("선물 계약 수를 1 이상 입력해 주세요.");
      return;
    }

    try {
      const response=await apiFetch("/api/accounts/me/futures",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:selected.symbol,side,quantity:qty})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"선물 주문 실패");
      setCash(result.account.krwBalance);setFuturesPositions((prev)=>[...prev,{...result.position,assetId:selected.id,name:selected.name}]);
      addFilledOrder({id:result.position.id,assetId:selected.id,symbol:selected.symbol,name:selected.name,category,side:side==="LONG"?"BUY":"SELL",orderType:"MARKET",quantity:qty,limitPrice:null,orderedAt:new Date().toLocaleTimeString("ko-KR")},result.position.entryPrice);
      setMessage(`${selected.name} ${side==="LONG"?"매수":"매도"} ${qty}계약 체결`);pushTrade(`선물옵션 · ${selected.name} ${side} ${qty}계약 · ${result.position.entryPrice.toFixed(2)}`);
    } catch(error){setMessage(`${selected.name} 선물 주문 실패 · ${error.message}`);}
  }

  // 선택 포지션의 증거금과 실현손익을 현금으로 돌려주고 포지션을 닫는다.
  async function closeFuture(id) {
    const pos = futuresPositions.find((x) => x.id === id);
    if (!pos) return;

    try{const response=await apiFetch(`/api/accounts/me/futures/${id}/close`,{method:"POST"});const result=await response.json();if(!response.ok)throw new Error(result.error||"선물 청산 실패");setCash(result.account.krwBalance);setFuturesPositions((prev)=>prev.filter((x)=>x.id!==id));setMessage(`${pos.name} 청산 완료 · 손익 ${money(result.pnl)}`);pushTrade(`선물옵션 · ${pos.name} ${pos.side} 청산 · 손익 ${money(result.pnl)}`);}catch(error){setMessage(`${pos.name} 청산 실패 · ${error.message}`);}
  }

  // 모든 모의 거래·잔고·입력값을 최초 상태로 되돌린다.
  async function reset() {
    try {
      const response = await apiFetch("/api/accounts/me/reset", { method: "POST" });
      const account = await response.json();
      if (!response.ok) throw new Error(account.error || "계좌 초기화 실패");
      setMarkets(cloneMarkets());
      setCash(account.krwBalance);
      setForeignCash(account.usdBalance);
    setFinanceAccount({
      credit: { active: false, limit: 0, debt: 0 },
      margin: { active: false, limit: 0, debt: 0 },
      lending: { active: false, limit: 0, locked: 0 },
      collateral: { active: false, limit: 0, debt: 0 },
    });
    setSpotPositions({});
    setShortPositions({});
    setFuturesPositions([]);
    setTrades([]);
    setPendingOrders([]);
    setFilledOrders([]);
    setOrderTab("order");
    setOrderType("MARKET");
    setLimitPrice("");
    setChartData({});
    setCategory("stocks");
    setSelectedId(INITIAL_MARKETS.stocks[0].id);
    setQuantity("1");
      setMessage("모의투자 계좌가 초기화되었습니다.");
    } catch (error) {
      setMessage(`계좌 초기화 실패 · ${error.message}`);
    }
  }


  // 특정 위젯의 크기·접힘·숨김 속성 일부만 병합해 갱신한다.
  function updateDashboardWidget(id, patch) {
    setDashboardWidgets((prev) =>
      prev.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)),
    );
  }

  // 포인터 이동량을 12열 그리드 폭과 높이로 환산해 위젯을 실시간 리사이즈한다.
  function startDashboardResize(event, widget) {
    if (!editDashboard || widget.collapsed) return;
    event.preventDefault();
    event.stopPropagation();

    const grid = event.currentTarget.closest(".dashboard-grid");
    const card = event.currentTarget.closest(".dashboard-widget");
    if (!grid || !card) return;

    const gridRect = grid.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = cardRect.width;
    const startHeight = cardRect.height;
    const minWidth = Math.min(320, gridRect.width);

    setResizingWidget(widget.id);
    document.body.classList.add("dashboard-resizing");

    const onMove = (moveEvent) => {
      const nextWidth = Math.max(minWidth, Math.min(gridRect.width, startWidth + moveEvent.clientX - startX));
      const nextHeight = Math.max(250, Math.min(680, startHeight + moveEvent.clientY - startY));
      const nextCols = Math.max(4, Math.min(12, Math.round((nextWidth / gridRect.width) * 12)));
      const snappedHeight = Math.round(nextHeight / 10) * 10;

      setDashboardWidgets((prev) => prev.map((item) =>
        item.id === widget.id ? { ...item, cols: nextCols, height: snappedHeight } : item,
      ));
    };

    const onUp = () => {
      setResizingWidget(null);
      document.body.classList.remove("dashboard-resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // 드래그한 위젯을 대상 위젯 위치로 옮겨 표시 순서를 변경한다.
  function moveDashboardWidget(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;

    setDashboardWidgets((prev) => {
      const next = [...prev];
      const sourceIndex = next.findIndex((widget) => widget.id === sourceId);
      const targetIndex = next.findIndex((widget) => widget.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  // 저장된 사용자 배치를 제거하고 모든 위젯을 기본 배치로 복원한다.
  function resetDashboardLayout() {
    setDashboardWidgets(DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })));
    setDraggingWidget(null);
    setDragOverWidget(null);
    setResizingWidget(null);
    document.body.classList.remove("dashboard-resizing");
  }

  // 상품/정보 페이지에서 거래 탭의 특정 상품군과 종목으로 이동한다.
  function goTrading(nextCategory = "stocks", assetId = null) {
    setMainTab("trading");
    setCategory(nextCategory);
    const list = markets[nextCategory] ?? markets.stocks;
    const target = assetId ? list.find((item) => item.id === assetId) : null;
    setSelectedId(target?.id ?? list[0]?.id ?? INITIAL_MARKETS.stocks[0].id);
    setQuantity(nextCategory === "crypto" ? "0.01" : "1");
  }

  // 투자정보에서 선택한 주식의 거래 화면을 여는 전용 이동 함수다.
  function openStockFromInfo(assetId) {
    goTrading("stocks", assetId);
  }

  // 통합검색 결과를 선택하면 검색창을 닫고 해당 상품의 거래 화면으로 이동한다.
  function openSearchResult(result) {
    goTrading(result.category, result.asset.id);
    setHeaderSearchQuery("");
    setHeaderSearchOpen(false);
  }

  // 위젯 ID에 맞는 보유상품·선물 포지션·체결내역 콘텐츠를 선택해 렌더링한다.
  function renderDashboardContent(widgetId) {
    if (widgetId === "holdings") {
      return (
        <div className="table-wrap dashboard-table-wrap">
          <table>
            <thead>
              <tr><th>종목명</th><th>보유수량</th><th>평균단가</th><th>현재가</th><th>평가금액</th><th>평가손익</th></tr>
            </thead>
            <tbody>
              {Object.keys(spotPositions).length === 0 && Object.keys(shortPositions).length === 0 ? (
                <tr><td colSpan="6" className="empty">보유 중인 상품이 없습니다.</td></tr>
              ) : <>{Object.entries(spotPositions).map(([id, pos]) => {
                const asset = allAssets.find((x) => x.id === id);
                const currentPriceKRW = asset ? spotPriceInKRW(asset) : 0;
                const pnl = asset ? (currentPriceKRW - pos.avgPrice) * pos.quantity : 0;
                const valuation = asset ? currentPriceKRW * pos.quantity : 0;
                return (
                  <tr key={id}>
                    <td><div className="holding-asset-cell"><AssetLogo asset={asset} size="xs" /><div><strong>{asset?.name}</strong><span className="sub-code">{asset?.symbol}</span></div></div></td>
                    <td>{pos.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td>{money(pos.avgPrice)}</td>
                    <td>{asset ? assetPrice(asset) : "-"}</td>
                    <td>{money(valuation)}</td>
                    <td className={pnl >= 0 ? "up" : "down"}>{money(pnl)}</td>
                  </tr>
                );
              })}{Object.entries(shortPositions).map(([id, pos]) => {
                const asset = allAssets.find((item) => item.id === id);
                const current = asset ? spotPriceInKRW(asset) : 0;
                const pnl = (pos.avgPrice - current) * pos.quantity;
                return <tr key={`short-${id}`}><td><div className="holding-asset-cell"><AssetLogo asset={asset} size="xs" /><div><strong>{asset?.name} <em>대주</em></strong><span className="sub-code">{asset?.symbol}</span></div></div></td><td className="down">-{pos.quantity.toLocaleString()}</td><td>{money(pos.avgPrice)}</td><td>{asset ? assetPrice(asset) : "-"}</td><td>{money(current * pos.quantity)}</td><td className={pnl >= 0 ? "up" : "down"}>{money(pnl)}</td></tr>;
              })}</>}
            </tbody>
          </table>
        </div>
      );
    }

    if (widgetId === "futures") {
      return (
        <div className="table-wrap dashboard-table-wrap">
          <table>
            <thead><tr><th>상품</th><th>구분</th><th>계약</th><th>진입가</th><th>평가손익</th><th></th></tr></thead>
            <tbody>
              {futuresPositions.length === 0 ? (
                <tr><td colSpan="6" className="empty">미결제 포지션이 없습니다.</td></tr>
              ) : futuresPositions.map((pos) => {
                const asset = markets.futures.find((x) => x.id === pos.assetId);
                const direction = pos.side === "LONG" ? 1 : -1;
                const pnl = (asset.price - pos.entryPrice) * asset.multiplier * pos.quantity * direction;
                return (
                  <tr key={pos.id}>
                    <td>{pos.name}</td>
                    <td className={pos.side === "LONG" ? "up" : "down"}>{pos.side === "LONG" ? "매수" : "매도"}</td>
                    <td>{pos.quantity}</td>
                    <td>{pos.entryPrice.toLocaleString()}</td>
                    <td className={pnl >= 0 ? "up" : "down"}>{money(pnl)}</td>
                    <td><button className="close" onClick={() => closeFuture(pos.id)}>청산</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="history dashboard-history">
        {trades.length === 0 ? (
          <div className="empty-block">오늘 체결된 주문이 없습니다.</div>
        ) : trades.map((trade) => (
          <div className="history-row" key={trade.id}>
            <span>{trade.time}</span>
            <strong>{trade.text}</strong>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="terminal">
      <header className="topbar">
        <div className="topbar-inner">
          <button type="button" className="brand" onClick={() => setMainTab("trading")} aria-label="POSCO 증권 홈">
            <img className="brand-mark" src={poscoLogo} alt="POSCO" />
            <div className="brand-copy">
              <strong>증권</strong>
              <span>모의투자</span>
            </div>
          </button>

          <nav className="main-nav" aria-label="주요 메뉴">
            <button className={mainTab === "trading" ? "active" : ""} type="button" onClick={() => setMainTab("trading")}>홈</button>
            <button className={mainTab === "info" ? "active" : ""} type="button" onClick={() => setMainTab("info")}>피드</button>
            <button className={mainTab === "products" ? "active" : ""} type="button" onClick={() => setMainTab("products")}>주식 골라보기</button>
            <button className={mainTab === "assets" ? "active" : ""} type="button" onClick={() => setMainTab("assets")}>내 자산</button>
            <button className={mainTab === "banking" ? "active" : ""} type="button" onClick={() => setMainTab("banking")}>뱅킹</button>
            <button className={mainTab === "summary" ? "active" : ""} type="button" onClick={() => setMainTab("summary")}>요약</button>
            <button className={mainTab === "operations" ? "active" : ""} type="button" onClick={() => setMainTab("operations")}>운영 상태</button>
          </nav>

          <div className="header-actions">
            <div
              className={`header-global-search ${headerSearchOpen ? "is-open" : ""}`}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setHeaderSearchOpen(false);
              }}
            >
              {headerSearchOpen && (
                <form
                  className="header-search-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (headerSearchResults[0]) openSearchResult(headerSearchResults[0]);
                  }}
                >
                  <input
                    autoFocus
                    value={headerSearchQuery}
                    onChange={(event) => setHeaderSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setHeaderSearchOpen(false);
                        setHeaderSearchQuery("");
                      }
                    }}
                    placeholder="종목명·코드 검색"
                    aria-label="전체 종목 검색어"
                  />
                </form>
              )}
              <button
                type="button"
                className="header-search"
                onClick={() => setHeaderSearchOpen((open) => !open)}
                aria-label={headerSearchOpen ? "종목 검색 닫기" : "종목 검색"}
                aria-expanded={headerSearchOpen}
              >⌕</button>
              {headerSearchOpen && headerSearchQuery.trim() && (
                <div className="header-search-results" role="listbox" aria-label="종목 검색 결과">
                  {headerSearchResults.length ? headerSearchResults.map((result) => (
                    <button
                      type="button"
                      key={`${result.category}:${result.asset.id}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => openSearchResult(result)}
                      role="option"
                    >
                      <AssetLogo asset={result.asset} size="xs" />
                      <span><strong>{result.asset.name}</strong><em>{result.asset.symbol} · {LABELS[result.category]}</em></span>
                      <b>{assetPrice(result.asset)}</b>
                    </button>
                  )) : <div className="header-search-empty">검색 결과가 없습니다.</div>}
                </div>
              )}
            </div>
            <button type="button" className="account-mini" onClick={() => setMainTab("assets")}>
              <span>모의계좌</span>
              <strong>{accountNumber}</strong>
            </button>
            <button type="button" className="logout-button" onClick={onSignOut} title={session.user.email}>로그아웃</button>
            <button type="button" className="theme-toggle" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"} aria-pressed={theme === "dark"} title={theme === "dark" ? "라이트 모드" : "다크 모드"}>
              <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            </button>
          </div>
        </div>
      </header>

      {mainTab === "trading" && (
        <>
      <section className="account-strip">
        <div className="market-status">
          <span className="status-dot" />
          <strong>{realtimeStatus.connected ? "KIS 실시간 연결" : marketDataStatus.connected ? "KIS REST 연결" : "시세 연결 중"}</strong>
          <span>{realtimeStatus.connected
            ? `${selected.name} 체결가·호가 WebSocket 수신`
            : marketDataStatus.connected ? `전체 ${marketDataStatus.cachedSymbols}종목 REST 폴백` : "마지막 정상 가격 유지"}</span>
        </div>
        {riskStatus && riskStatus.status!=="SAFE" && <div className={`risk-alert ${riskStatus.status.toLowerCase()}`}><strong>{riskStatus.status==="WARNING"?"증거금 주의":riskStatus.status==="MARGIN_CALL"?"마진콜 발생":"강제청산 위험"}</strong><span>위험비율 {riskStatus.requiredMargin>0?`${((riskStatus.equity/riskStatus.requiredMargin)*100).toFixed(1)}%`:"-"} · 부족액 {money(riskStatus.deficit)}</span></div>}
        <div className="top-metrics">
          {/* 홈 계좌 핵심 수치는 한 그룹으로 유지하고 초기화 동작은 별도 버튼으로 분리한다. */}
          <div className="top-metric-cards">
            <div><span>총 평가자산</span><strong>{money(totalAssets)}</strong></div>
            <div><span>주문가능금액</span><strong>{money(cash)}</strong></div>
            <div>
              <span>평가손익</span>
              <strong className={totalPnl >= 0 ? "up" : "down"}>{money(totalPnl)}</strong>
            </div>
            <div>
              <span>수익률</span>
              <strong className={totalPnl >= 0 ? "up" : "down"}>{signedPercent(totalReturn)}</strong>
            </div>
          </div>
          <button className="reset" onClick={reset}>계좌 초기화</button>
        </div>
      </section>

      <div className="tabs">
        {Object.entries(LABELS).map(([key, label]) => (
          <button
            key={key}
            className={category === key ? "active" : ""}
            onClick={() => setCategory(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <main className="workspace">
        <aside className="panel left-panel">
          <div className="panel-title">
            <div><span>종목</span><strong>관심·시세</strong></div>
            <em>{assets.length}종목</em>
          </div>
          <MarketList
            assets={assets}
            selectedId={selected.id}
            onSelect={setSelectedId}
            type={category}
            favorites={favorites}
            onToggleFavorite={toggleFavorite}
          />
        </aside>

        <section className="center">
          <div className="panel instrument">
            <div className="instrument-identity">
              <AssetLogo asset={selected} size="xl" />
              <div className="instrument-name">
                <span>{LABELS[category]} · {selected.symbol}</span>
                <h1>{selected.name}</h1>
                <div className="badges">
                  <b>{selected.market || LABELS[category]}</b>
                  <b>{selected.priceSource || "모의투자"}</b>
                  {selected.synthetic && <b className="synthetic-badge">일간 10배 · 고위험</b>}
                </div>
              </div>
            </div>

            <div className="quote-summary">
              <div className="price-box">
                <strong>{assetPrice(selected)}</strong>
                {category === "bonds" ? (
                  <span className="yield">수익률 {selected.yield.toFixed(2)}%</span>
                ) : (
                  <span className={selected.change >= 0 ? "up" : "down"}>
                    {signedPercent(selected.change)}
                  </span>
                )}
              </div>
              <div className="quote-mini-grid">
                <div><span>매도호가</span><strong className="up">{assetPrice({ ...selected, price: bestAsk })}</strong></div>
                <div><span>매수호가</span><strong className="down">{assetPrice({ ...selected, price: bestBid })}</strong></div>
              </div>
            </div>
          </div>

          <div className="trading-grid">
            <div className="panel chart-panel">
              <div className="chart-head">
                <div className="chart-periods">
                  <strong>종합차트</strong>
                  {[
                    ["1m", "1분"],
                    ["5m", "5분"],
                    ["30m", "30분"],
                    ["60m", "60분"],
                    ["day", "일"],
                  ].map(([key, label]) => (
                    <button
                      type="button"
                      key={key}
                      className={chartPeriod === key ? "active" : ""}
                      onClick={() => setChartPeriod(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span>휠 확대·축소 · 본문 이동 · 하단 시간축 간격 조절</span>
              </div>
              {chartLoading && !chartData[`${selected.symbol}:${chartPeriod}`] ? (
                <div className="chart-empty">실제 {chartPeriod === "day" ? "일봉" : `${chartPeriod}봉`}을 불러오고 있습니다...</div>
              ) : chartError && !chartData[`${selected.symbol}:${chartPeriod}`] ? (
                <div className="chart-empty">{chartError}</div>
              ) : (
                <Sparkline
                  candles={chartData[`${selected.symbol}:${chartPeriod}`] || null}
                  values={chartData[selected.id] ?? [selected.price]}
                  asset={selected}
                  period={chartPeriod}
                />
              )}
              <div className="chart-foot">
                <span>시가 {assetPrice({ ...selected, price: selected.open ?? selected.price })}</span>
                <span>고가 {assetPrice({ ...selected, price: selected.high ?? selected.price * 1.006 })}</span>
                <span>저가 {assetPrice({ ...selected, price: selected.low ?? selected.price * 0.994 })}</span>
                <span>거래량 {(selected.volume ?? Math.abs(Math.round(selected.price)) % 900000 + 120000).toLocaleString()}</span>
              </div>
            </div>

            <div className="panel order-panel">
              <div className="order-tabs">
                <button className={orderTab === "order" ? "active" : ""} type="button" onClick={() => setOrderTab("order")}>주문</button>
                <button className={orderTab === "pending" ? "active" : ""} type="button" onClick={() => setOrderTab("pending")}>미체결 <b>{pendingOrders.length}</b></button>
                <button className={orderTab === "filled" ? "active" : ""} type="button" onClick={() => setOrderTab("filled")}>체결 <b>{filledOrders.length}</b></button>
              </div>

              {orderTab === "order" && (
                <>
              <div className="order-heading">
                <span>{selected.name}</span>
                <strong>{assetPrice(selected)}</strong>
              </div>

              {category === "stocks" && selected.unit === "KRW" && (
                <div className="realtime-orderbook">
                  <div className="orderbook-title"><strong>실시간 호가</strong><span>{orderBook ? "10단계 WebSocket" : "REST 기준 추정호가"}</span></div>
                  {orderBook ? <>
                    {[...orderBook.asks].reverse().map((level, index) => (
                      <button type="button" className="orderbook-level ask" key={`ask-${index}`} onClick={() => { setOrderType("LIMIT"); setLimitPrice(String(level.price)); }}>
                        <span>{level.quantity?.toLocaleString() ?? "-"}</span><strong>{level.price?.toLocaleString()}</strong><em>매도 {10-index}</em>
                      </button>
                    ))}
                    {[...orderBook.bids].map((level, index) => (
                      <button type="button" className="orderbook-level bid" key={`bid-${index}`} onClick={() => { setOrderType("LIMIT"); setLimitPrice(String(level.price)); }}>
                        <span>{level.quantity?.toLocaleString() ?? "-"}</span><strong>{level.price?.toLocaleString()}</strong><em>매수 {index+1}</em>
                      </button>
                    ))}
                    <div className="orderbook-total"><span>총 매도 {orderBook.totalAskQuantity?.toLocaleString()}</span><span>총 매수 {orderBook.totalBidQuantity?.toLocaleString()}</span></div>
                  </> : <div className="orderbook-waiting">실시간 호가를 연결하고 있습니다. 연결 전에는 상단 추정 최우선 호가를 사용합니다.</div>}
                </div>
              )}

              {category === "bonds" && (
                <div className="info-grid">
                  <div><span>수익률</span><strong>{selected.yield.toFixed(2)}%</strong></div>
                  <div><span>표면금리</span><strong>{selected.coupon.toFixed(2)}%</strong></div>
                  <div><span>만기</span><strong>{selected.maturity}</strong></div>
                  <div><span>듀레이션</span><strong>{selected.duration.toFixed(1)}</strong></div>
                </div>
              )}

              {category === "futures" && (
                <div className="info-grid">
                  <div><span>승수</span><strong>{selected.multiplier.toLocaleString()}</strong></div>
                  <div><span>증거금률</span><strong>{Math.round(selected.marginRate * 100)}%</strong></div>
                  <div><span>1계약 증거금</span><strong>{money(selected.price * selected.multiplier * selected.marginRate)}</strong></div>
                  <div><span>주문구분</span><strong>신규</strong></div>
                </div>
              )}

              <div className="order-form">
                <div className="order-line">
                  <span>주문유형</span>
                  <select
                    className="order-type-select"
                    value={category === "futures" ? "MARKET" : orderType}
                    disabled={category === "futures"}
                    onChange={(event) => {
                      setOrderType(event.target.value);
                      if (event.target.value === "LIMIT") setLimitPrice(String(Number(selected.price.toFixed(2))));
                    }}
                  >
                    <option value="MARKET">시장가</option>
                    <option value="LIMIT">지정가</option>
                  </select>
                </div>
                <div className="order-line">
                  <span>주문가격</span>
                  {orderType === "LIMIT" && category !== "futures" ? (
                    <input
                      className="limit-price-input"
                      type="number"
                      min="0"
                      step={selected.unit === "USD" ? "0.01" : "1"}
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(event.target.value)}
                    />
                  ) : <strong>{assetPrice(selected)}</strong>}
                </div>
                <div className="order-line quantity-line">
                  <span>{category === "futures" ? "계약수" : "주문수량"}</span>
                  <div className="quantity-control">
                    <input
                      type="number"
                      min="0"
                      step={category === "crypto" ? "0.000001" : "1"}
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                    <button type="button" className="quantity-max" onClick={setMaximumOrderQuantity}>최대</button>
                  </div>
                </div>
                <div className="order-line">
                  <span>주문가능</span>
                  <strong>{money(cash)}</strong>
                </div>
                {category === "stocks" && financeAccount.lending.active && (
                  <div className="order-line lending-order-info">
                    <span>대주 가능 / 잔고</span>
                    <strong>{money(Math.max(0, financeAccount.lending.limit - lendingUsed))} / {money(lendingUsed)}</strong>
                  </div>
                )}
                {category === "stocks" && selected.unit === "USD" && (
                  <div className="order-line">
                    <span>적용환율(모의)</span>
                    <strong>$1 = {USD_KRW.toLocaleString()}원</strong>
                  </div>
                )}
              </div>

              {category === "futures" ? (
                <div className="order-buttons">
                  <button className="buy" onClick={() => openFuture("LONG")}>매수 LONG</button>
                  <button className="sell" onClick={() => openFuture("SHORT")}>매도 SHORT</button>
                </div>
              ) : (
                <div className="order-buttons">
                  <button className="buy" onClick={buySpot}>매수</button>
                  <button className="sell" onClick={sellSpot}>매도</button>
                </div>
              )}

              <div className="message"><b>주문 알림</b>{message}</div>
                </>
              )}

              {orderTab === "pending" && (
                <div className="order-status-list">
                  {pendingOrders.length === 0 ? <div className="order-status-empty">미체결 주문이 없습니다.</div> : pendingOrders.map((order) => (
                    <article key={order.id} className="order-status-item">
                      <div><strong>{order.name}</strong><span>{order.symbol} · {order.orderedAt}</span></div>
                      <div><b className={order.side === "BUY" ? "up" : "down"}>{order.side === "BUY" ? "매수" : "매도"}</b><strong>{order.quantity} · {assetPrice({ ...allAssets.find((item) => item.id === order.assetId), price: order.limitPrice })}</strong></div>
                      <div className="order-item-actions"><button type="button" onClick={() => amendPendingOrder(order)}>정정</button><button type="button" onClick={() => cancelPendingOrder(order)}>취소</button></div>
                    </article>
                  ))}
                </div>
              )}

              {orderTab === "filled" && (
                <div className="order-status-list">
                  {filledOrders.length === 0 ? <div className="order-status-empty">체결 주문이 없습니다.</div> : filledOrders.map((order) => (
                    <article key={order.id} className="order-status-item is-filled">
                      <div><strong>{order.name}</strong><span>{order.symbol} · {order.filledAt}</span></div>
                      <div><b className={order.side === "BUY" ? "up" : "down"}>{order.side === "BUY" ? "매수" : "매도"}</b><strong>{order.quantity} · {assetPrice({ ...allAssets.find((item) => item.id === order.assetId), price: order.executionPrice })}</strong></div>
                      <em>{order.orderType === "LIMIT" ? "지정가" : "시장가"} 체결</em>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

        </section>

        <div className="panel account-panel home-wide-panel">
          <div className="panel-title">
            <div><span>계좌</span><strong>자산현황</strong></div>
            <em>모의투자</em>
          </div>
          <div className="summary">
            <div><span>예수금</span><strong>{money(cash)}</strong></div>
            <div><span>주식·채권 평가액</span><strong>{money(spotValue)}</strong></div>
            <div><span>선물 증거금</span><strong>{money(marginTotal)}</strong></div>
            <div><span>선물 평가손익</span><strong className={futuresPnl >= 0 ? "up" : "down"}>{money(futuresPnl)}</strong></div>
            <div><span>총 평가손익</span><strong className={totalPnl >= 0 ? "up" : "down"}>{money(totalPnl)}</strong></div>
            <div><span>총 평가자산</span><strong>{money(totalAssets)}</strong></div>
          </div>
        </div>
        {category === "stocks" && (selected.synthetic
          ? <section className="panel synthetic-product-info home-wide-panel"><strong>10배 레버리지 모의 ETF</strong><p>삼성전자와 SK하이닉스의 당일 등락률을 동일 비중으로 합산한 뒤 10배로 추종합니다. 일간 재조정 상품이므로 장기 누적수익은 기초종목 누적수익의 정확한 10배가 아니며, 급락 시 원금 대부분을 잃을 수 있습니다.</p><div><span>기초자산 <b>삼성전자 50% · SK하이닉스 50%</b></span><span>기준가 <b>10,000원</b></span><span>레버리지 <b>일간 10배</b></span></div></section>
          : <div className="home-wide-panel"><StockFundamentals asset={selected} /></div>)}
      </main>

      <section className={`dashboard-section ${editDashboard ? "is-editing" : ""}`}>
        <div className="dashboard-toolbar">
          <div>
            <span>MY 투자 화면</span>
            <strong>내가 원하는 순서와 크기로 배치</strong>
            {editDashboard && <small>⠿로 이동 · 카드 오른쪽 아래 모서리를 드래그해 가로·세로 크기 조절</small>}
          </div>
          <div className="dashboard-toolbar-actions">
            {editDashboard && (
              <button type="button" className="dashboard-reset" onClick={resetDashboardLayout}>기본 배치 복원</button>
            )}
            <button
              type="button"
              className={`dashboard-edit ${editDashboard ? "active" : ""}`}
              onClick={() => setEditDashboard((prev) => !prev)}
            >
              {editDashboard ? "편집 완료" : "내 화면 편집"}
            </button>
          </div>
        </div>

        {editDashboard && dashboardWidgets.some((widget) => widget.hidden) && (
          <div className="hidden-widget-tray">
            <span>숨긴 창</span>
            {dashboardWidgets.filter((widget) => widget.hidden).map((widget) => (
              <button
                type="button"
                key={widget.id}
                onClick={() => updateDashboardWidget(widget.id, { hidden: false, collapsed: false })}
              >
                + {DASHBOARD_META[widget.id].title}
              </button>
            ))}
          </div>
        )}

        <div className="dashboard-grid">
          {dashboardWidgets.filter((widget) => !widget.hidden).map((widget) => {
            const meta = DASHBOARD_META[widget.id];
            const dynamicDescription = widget.id === "futures"
              ? `${futuresPositions.length}건`
              : widget.id === "history"
                ? `최근 ${Math.min(trades.length, 40)}건`
                : meta.description;

            return (
              <article
                key={widget.id}
                className={`panel dashboard-widget ${widget.collapsed ? "is-collapsed" : ""} ${dragOverWidget === widget.id ? "drag-over" : ""} ${resizingWidget === widget.id ? "is-resizing" : ""}`}
                style={{
                  gridColumn: `span ${widget.cols}`,
                  height: widget.collapsed ? "auto" : `${widget.height}px`,
                }}
                onDragOver={(event) => {
                  if (!editDashboard) return;
                  event.preventDefault();
                  setDragOverWidget(widget.id);
                }}
                onDrop={(event) => {
                  if (!editDashboard) return;
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData("text/plain") || draggingWidget;
                  moveDashboardWidget(sourceId, widget.id);
                  setDraggingWidget(null);
                  setDragOverWidget(null);
                }}
              >
                <div className="dashboard-widget-head">
                  <div className="dashboard-widget-title">
                    {editDashboard && (
                      <span
                        className="drag-handle"
                        aria-label={`${meta.title} 이동`}
                        title="잡아서 순서 이동"
                        draggable
                        onDragStart={(event) => {
                          setDraggingWidget(widget.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", widget.id);
                        }}
                        onDragEnd={() => {
                          setDraggingWidget(null);
                          setDragOverWidget(null);
                        }}
                      >
                        ⠿
                      </span>
                    )}
                    <div>
                      <span>{meta.eyebrow}</span>
                      <strong>{meta.title}</strong>
                    </div>
                  </div>
                  <div className="dashboard-widget-actions">
                    <em>
                      {editDashboard
                        ? `${widget.cols}/12 · ${widget.height}px`
                        : dynamicDescription}
                    </em>
                    {editDashboard && (
                      <button
                        type="button"
                        onClick={() => updateDashboardWidget(widget.id, { hidden: true })}
                      >
                        숨기기
                      </button>
                    )}
                    <button
                      type="button"
                      className="collapse-widget"
                      aria-label={widget.collapsed ? `${meta.title} 펼치기` : `${meta.title} 접기`}
                      onClick={() => updateDashboardWidget(widget.id, { collapsed: !widget.collapsed })}
                    >
                      {widget.collapsed ? "＋" : "－"}
                    </button>
                  </div>
                </div>

                {!widget.collapsed && (
                  <div className="dashboard-widget-body">{renderDashboardContent(widget.id)}</div>
                )}

                {editDashboard && !widget.collapsed && (
                  <button
                    type="button"
                    className="widget-resize-handle"
                    aria-label={`${meta.title} 크기 조절`}
                    title="오른쪽 아래 모서리를 드래그해 크기 조절"
                    onPointerDown={(event) => startDashboardResize(event, widget)}
                  >
                    <span />
                  </button>
                )}
              </article>
            );
          })}
        </div>

        {dashboardWidgets.every((widget) => widget.hidden) && (
          <div className="dashboard-empty-state">
            <strong>표시 중인 투자 창이 없습니다.</strong>
            <span>내 화면 편집에서 필요한 창을 다시 추가해 주세요.</span>
            <button type="button" onClick={resetDashboardLayout}>기본 배치로 되돌리기</button>
          </div>
        )}
      </section>
        </>
      )}

      <Suspense fallback={<main className="page-loading">화면을 불러오고 있습니다...</main>}>
      {mainTab === "assets" && (
        <AssetOverview
          cash={cash}
          foreignCash={foreignCash}
          usdKrw={USD_KRW}
          spotPositions={spotPositions}
          futuresPositions={futuresPositions}
          allAssets={allAssets}
          spotValue={spotValue}
          spotCost={spotCost}
          futuresPnl={futuresPnl}
          marginTotal={marginTotal}
          totalAssets={totalAssets}
          totalPnl={totalPnl}
          totalReturn={totalReturn}
          financeDebt={financeDebt}
          lendingCollateral={lendingCollateral}
          lendingUsed={lendingUsed}
          spotPriceInKRW={spotPriceInKRW}
          assetPrice={assetPrice}
          orderEvents={orderEvents}
          ledgerEntries={ledgerEntries}
          settlements={settlements}
          onGoTrading={goTrading}
        />
      )}

      {mainTab === "info" && <InvestmentInfo markets={markets} indices={marketIndices} onOpenAsset={openStockFromInfo} />}
      {mainTab === "products" && <Products onGoTrading={goTrading} markets={markets} indices={marketIndices} />}
      {mainTab === "banking" && (
        <Banking
          cash={cash}
          setCash={setCash}
          foreignCash={foreignCash}
          setForeignCash={setForeignCash}
          usdKrw={USD_KRW}
          stockValue={Object.entries(spotPositions).reduce((sum,[id,pos])=>{const asset=allAssets.find((item)=>item.id===id);return sum+(pos.type==="stocks"&&asset?spotPriceInKRW(asset)*pos.quantity:0);},0)}
          financeAccount={financeAccount}
          setFinanceAccount={setFinanceAccount}
          lendingUsed={lendingUsed}
        />
      )}
      {mainTab === "summary" && <MarketSummary stocks={markets.stocks} indices={marketIndices} onOpenAsset={openStockFromInfo} />}
      {mainTab === "operations" && <Operations />}
      </Suspense>

      <footer>
        <strong>포스코증권 모의투자</strong>
        <span>본 화면은 학습용 가상 증권 서비스이며 실제 금융회사·실제 주문 시스템과 연결되어 있지 않습니다. 모든 시세는 임의 생성 데이터입니다.</span>
      </footer>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(() => new URLSearchParams(window.location.search).has("password-recovery"));

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) { setSession(data.session); setAuthReady(true); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  if (!authReady) return <main className="auth-page"><div className="auth-loading">로그인 상태를 확인하고 있습니다...</div></main>;
  if (passwordRecovery && session) return <PasswordRecovery onDone={() => setPasswordRecovery(false)} />;
  if (!session) return <AuthScreen />;
  return <TradingApp session={session} onSignOut={() => supabase.auth.signOut()} />;
}
