import React, { useEffect, useMemo, useState } from "react";
import { INITIAL_MARKETS } from "./data/markets.js";
import MarketList from "./components/MarketList.jsx";
import Sparkline from "./components/Sparkline.jsx";
import AssetLogo from "./components/AssetLogo.jsx";
import AssetOverview from "./pages/AssetOverview.jsx";
import InvestmentInfo from "./pages/InvestmentInfo.jsx";
import Products from "./pages/Products.jsx";
import Banking from "./pages/Banking.jsx";
import poscoLogo from "./assets/posco-ci-blue.png";

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
  return JSON.parse(JSON.stringify(INITIAL_MARKETS));
}

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

function money(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.round(value)).toLocaleString()}원`;
}

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

function spotPriceInKRW(asset) {
  if (!asset) return 0;
  return asset.unit === "USD" ? asset.price * USD_KRW : asset.price;
}

export default function App() {
  const [markets, setMarkets] = useState(cloneMarkets);
  const [mainTab, setMainTab] = useState("trading");
  const [foreignCash, setForeignCash] = useState(0);
  const [category, setCategory] = useState("stocks");
  const [selectedId, setSelectedId] = useState(INITIAL_MARKETS.stocks[0].id);
  const [cash, setCash] = useState(STARTING_CASH);
  const [spotPositions, setSpotPositions] = useState({});
  const [futuresPositions, setFuturesPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [orderTab, setOrderTab] = useState("order");
  const [orderType, setOrderType] = useState("MARKET");
  const [limitPrice, setLimitPrice] = useState("");
  const [pendingOrders, setPendingOrders] = useState([]);
  const [filledOrders, setFilledOrders] = useState([]);
  const [quantity, setQuantity] = useState("1");
  const [chartData, setChartData] = useState({});
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

  const assets = markets[category];
  const selected = assets.find((a) => a.id === selectedId) ?? assets[0];

  useEffect(() => {
    const list = INITIAL_MARKETS[category];
    setSelectedId((prev) => list.some((item) => item.id === prev) ? prev : list[0].id);
    setQuantity(category === "crypto" ? "0.01" : "1");
    setOrderType("MARKET");
    setLimitPrice("");
  }, [category]);

  useEffect(() => {
    if (orderType === "LIMIT") setLimitPrice(String(Number(selected.price.toFixed(2))));
  }, [selected.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMarkets((prev) => {
        const next = JSON.parse(JSON.stringify(prev));

        Object.entries(next).forEach(([type, list]) => {
          list.forEach((asset) => {
            if (type === "stocks" && asset.priceSource?.startsWith("KIS")) return;
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

        return next;
      });
    }, 1500);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

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
            stocks: prev.stocks.map((asset) => {
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
            }),
          }));
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

  useEffect(() => {
    setChartData((prev) => {
      const old = prev[selected.id];
      const base = old?.length ? old : seedChartValues(selected.price);
      return { ...prev, [selected.id]: [...base, selected.price].slice(-96) };
    });
  }, [selected.id, selected.price]);

  useEffect(() => {
    if (category !== "stocks") return undefined;
    let active = true;
    let timer;
    const key = `${selected.symbol}:${chartPeriod}`;
    const normalRefreshMs = chartPeriod === "day" ? 300_000 : 60_000;

    const loadChart = async () => {
      let nextRefreshMs = normalRefreshMs;
      setChartLoading(true);
      try {
        const response = await fetch(`/api/charts/${encodeURIComponent(selected.symbol)}?period=${chartPeriod}`);
        const data = await response.json();
        if (!response.ok) {
          const error = new Error(data.error || `차트 API 오류 (${response.status})`);
          error.retryAfter = Number(data.retryAfter) || Number(response.headers.get("Retry-After")) || 0;
          throw error;
        }
        if (!active) return;
        setChartData((prev) => ({ ...prev, [key]: data.candles || [] }));
        setChartError("");
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

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(dashboardWidgets));
  }, [dashboardWidgets]);

  const allAssets = useMemo(() => Object.values(markets).flat(), [markets]);

  useEffect(() => {
    const order = pendingOrders.find((item) => {
      const asset = allAssets.find((candidate) => candidate.id === item.assetId);
      if (!asset) return false;
      return item.side === "BUY" ? asset.price <= item.limitPrice : asset.price >= item.limitPrice;
    });
    if (!order) return;

    const matchedAsset = allAssets.find((item) => item.id === order.assetId);
    if (matchedAsset && executeSpotOrder(order, matchedAsset.price)) {
      setPendingOrders((prev) => prev.filter((item) => item.id !== order.id));
    }
  }, [allAssets, pendingOrders]);

  const spotValue = useMemo(() => {
    return Object.entries(spotPositions).reduce((sum, [id, pos]) => {
      const asset = allAssets.find((x) => x.id === id);
      return sum + (asset ? spotPriceInKRW(asset) * pos.quantity : 0);
    }, 0);
  }, [spotPositions, allAssets]);

  const spotCost = useMemo(() => {
    return Object.values(spotPositions).reduce(
      (sum, pos) => sum + pos.avgPrice * pos.quantity,
      0,
    );
  }, [spotPositions]);

  const futuresPnl = useMemo(() => {
    return futuresPositions.reduce((sum, pos) => {
      const asset = markets.futures.find((x) => x.id === pos.assetId);
      if (!asset) return sum;
      const direction = pos.side === "LONG" ? 1 : -1;
      return sum + (asset.price - pos.entryPrice) * asset.multiplier * pos.quantity * direction;
    }, 0);
  }, [futuresPositions, markets]);

  const marginTotal = useMemo(
    () => futuresPositions.reduce((sum, pos) => sum + pos.margin, 0),
    [futuresPositions],
  );

  const totalAssets = cash + foreignCash * USD_KRW + spotValue + marginTotal + futuresPnl;
  const totalPnl = spotValue - spotCost + futuresPnl;
  const totalReturn = spotCost > 0 ? ((spotValue - spotCost + futuresPnl) / spotCost) * 100 : 0;

  const bestAsk = selected.price * 1.001;
  const bestBid = selected.price * 0.999;

  function pushTrade(text) {
    setTrades((prev) => [
      { id: crypto.randomUUID(), time: new Date().toLocaleTimeString("ko-KR"), text },
      ...prev,
    ].slice(0, 40));
  }

  function addFilledOrder(order, executionPrice) {
    setFilledOrders((prev) => [{
      ...order,
      status: "FILLED",
      executionPrice,
      filledAt: new Date().toLocaleTimeString("ko-KR"),
    }, ...prev].slice(0, 40));
  }

  function executeSpotOrder(order, executionPrice) {
    const asset = allAssets.find((item) => item.id === order.assetId);
    if (!asset) return false;
    const executionAsset = { ...asset, price: executionPrice };
    const amount = spotPriceInKRW(executionAsset) * order.quantity;

    if (order.side === "BUY") {
      if (amount > cash) {
        setMessage(`${asset.name} 지정가 매수 체결 실패 · 주문가능금액 부족`);
        return false;
      }
      setCash((prev) => prev - amount);
      setSpotPositions((prev) => {
        const old = prev[asset.id] ?? { quantity: 0, avgPrice: 0, type: order.category };
        const nextQuantity = old.quantity + order.quantity;
        return {
          ...prev,
          [asset.id]: {
            quantity: nextQuantity,
            avgPrice: ((old.avgPrice * old.quantity) + amount) / nextQuantity,
            type: order.category,
          },
        };
      });
    } else {
      const position = spotPositions[asset.id];
      if (!position || position.quantity < order.quantity) {
        setMessage(`${asset.name} 지정가 매도 체결 실패 · 보유수량 부족`);
        return false;
      }
      setCash((prev) => prev + amount);
      setSpotPositions((prev) => {
        const next = { ...prev };
        const left = next[asset.id].quantity - order.quantity;
        if (left <= 0.00000001) delete next[asset.id];
        else next[asset.id] = { ...next[asset.id], quantity: left };
        return next;
      });
    }

    addFilledOrder(order, executionPrice);
    pushTrade(`${LABELS[order.category]} · ${asset.name} ${order.quantity} ${order.side === "BUY" ? "매수" : "매도"} · ${assetPrice(executionAsset)}`);
    setMessage(`${asset.name} ${order.quantity} ${order.side === "BUY" ? "매수" : "매도"} 체결`);
    return true;
  }

  function placeSpotOrder(side) {
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
    if (side === "SELL" && (!spotPositions[selected.id] || spotPositions[selected.id].quantity < qty)) {
      setMessage("매도 가능한 보유수량이 부족합니다.");
      return;
    }
    const reservedSellQuantity = pendingOrders
      .filter((item) => item.assetId === selected.id && item.side === "SELL")
      .reduce((sum, item) => sum + item.quantity, 0);
    if (side === "SELL" && spotPositions[selected.id].quantity - reservedSellQuantity < qty) {
      setMessage("이미 접수된 미체결 주문을 제외하면 매도 가능한 수량이 부족합니다.");
      return;
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
      setOrderTab("filled");
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
      setPendingOrders((prev) => [order, ...prev]);
      setMessage(`${selected.name} ${qty} ${side === "BUY" ? "매수" : "매도"} 지정가 주문 접수`);
      setOrderTab("pending");
    }
  }

  function buySpot() {
    placeSpotOrder("BUY");
  }

  function sellSpot() {
    placeSpotOrder("SELL");
  }

  function openFuture(side) {
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty < 1) {
      setMessage("선물 계약 수를 1 이상 입력해 주세요.");
      return;
    }

    const margin = selected.price * selected.multiplier * selected.marginRate * qty;
    if (margin > cash) {
      setMessage("필요 증거금이 주문가능금액보다 큽니다.");
      return;
    }

    setCash((prev) => prev - margin);
    setFuturesPositions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        assetId: selected.id,
        name: selected.name,
        side,
        quantity: qty,
        entryPrice: selected.price,
        margin,
      },
    ]);

    addFilledOrder({
      id: crypto.randomUUID(),
      assetId: selected.id,
      symbol: selected.symbol,
      name: selected.name,
      category,
      side: side === "LONG" ? "BUY" : "SELL",
      orderType: "MARKET",
      quantity: qty,
      limitPrice: null,
      orderedAt: new Date().toLocaleTimeString("ko-KR"),
    }, selected.price);
    setMessage(`${selected.name} ${side === "LONG" ? "매수" : "매도"} ${qty}계약 체결`);
    pushTrade(`선물옵션 · ${selected.name} ${side} ${qty}계약 · ${selected.price.toFixed(2)}`);
  }

  function closeFuture(id) {
    const pos = futuresPositions.find((x) => x.id === id);
    if (!pos) return;

    const asset = markets.futures.find((x) => x.id === pos.assetId);
    const direction = pos.side === "LONG" ? 1 : -1;
    const pnl = (asset.price - pos.entryPrice) * asset.multiplier * pos.quantity * direction;

    setCash((prev) => prev + pos.margin + pnl);
    setFuturesPositions((prev) => prev.filter((x) => x.id !== id));
    setMessage(`${pos.name} 청산 완료 · 손익 ${money(pnl)}`);
    pushTrade(`선물옵션 · ${pos.name} ${pos.side} 청산 · 손익 ${money(pnl)}`);
  }

  function reset() {
    setMarkets(cloneMarkets());
    setCash(STARTING_CASH);
    setForeignCash(0);
    setSpotPositions({});
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
  }


  function updateDashboardWidget(id, patch) {
    setDashboardWidgets((prev) =>
      prev.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)),
    );
  }

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

  function resetDashboardLayout() {
    setDashboardWidgets(DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })));
    setDraggingWidget(null);
    setDragOverWidget(null);
    setResizingWidget(null);
    document.body.classList.remove("dashboard-resizing");
  }

  function goTrading(nextCategory = "stocks", assetId = null) {
    setMainTab("trading");
    setCategory(nextCategory);
    const list = markets[nextCategory] ?? markets.stocks;
    const target = assetId ? list.find((item) => item.id === assetId) : null;
    setSelectedId(target?.id ?? list[0]?.id ?? INITIAL_MARKETS.stocks[0].id);
    setQuantity(nextCategory === "crypto" ? "0.01" : "1");
  }

  function openStockFromInfo(assetId) {
    goTrading("stocks", assetId);
  }

  function renderDashboardContent(widgetId) {
    if (widgetId === "holdings") {
      return (
        <div className="table-wrap dashboard-table-wrap">
          <table>
            <thead>
              <tr><th>종목명</th><th>보유수량</th><th>평균단가</th><th>현재가</th><th>평가금액</th><th>평가손익</th></tr>
            </thead>
            <tbody>
              {Object.keys(spotPositions).length === 0 ? (
                <tr><td colSpan="6" className="empty">보유 중인 상품이 없습니다.</td></tr>
              ) : Object.entries(spotPositions).map(([id, pos]) => {
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
              })}
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
          </nav>

          <div className="header-actions">
            <button type="button" className="header-search" onClick={() => setMainTab("trading")} aria-label="종목 검색">⌕</button>
            <button type="button" className="account-mini" onClick={() => setMainTab("assets")}>
              <span>모의계좌</span>
              <strong>POSCO-000001</strong>
            </button>
          </div>
        </div>
      </header>

      {mainTab === "trading" && (
        <>
      <section className="account-strip">
        <div className="market-status">
          <span className="status-dot" />
          <strong>{marketDataStatus.connected ? "KIS 실제시세 연결" : "시세 연결 중"}</strong>
          <span>{marketDataStatus.connected ? `전체 ${marketDataStatus.cachedSymbols}종목 REST 수신` : "마지막 정상 가격 유지"}</span>
        </div>
        <div className="top-metrics">
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
                  <b>모의투자</b>
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
              {chartLoading && !chartData[`${selected.symbol}:${chartPeriod}`] && category === "stocks" ? (
                <div className="chart-empty">KIS 실제 {chartPeriod === "day" ? "일봉" : `${chartPeriod}봉`}을 불러오고 있습니다...</div>
              ) : chartError && !chartData[`${selected.symbol}:${chartPeriod}`] && category === "stocks" ? (
                <div className="chart-empty">{chartError}</div>
              ) : (
                <Sparkline
                  candles={category === "stocks" ? chartData[`${selected.symbol}:${chartPeriod}`] : null}
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
                <label className="order-line quantity-line">
                  <span>{category === "futures" ? "계약수" : "주문수량"}</span>
                  <input
                    type="number"
                    min="0"
                    step={category === "crypto" ? "0.01" : "1"}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </label>
                <div className="order-line">
                  <span>주문가능</span>
                  <strong>{money(cash)}</strong>
                </div>
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
                      <button type="button" onClick={() => {
                        setPendingOrders((prev) => prev.filter((item) => item.id !== order.id));
                        setMessage(`${order.name} 지정가 주문을 취소했습니다.`);
                      }}>취소</button>
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

          <div className="panel account-panel">
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
        </section>
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
          spotPriceInKRW={spotPriceInKRW}
          assetPrice={assetPrice}
          onGoTrading={goTrading}
        />
      )}

      {mainTab === "info" && <InvestmentInfo markets={markets} onOpenAsset={openStockFromInfo} />}
      {mainTab === "products" && <Products onGoTrading={goTrading} />}
      {mainTab === "banking" && (
        <Banking
          cash={cash}
          setCash={setCash}
          foreignCash={foreignCash}
          setForeignCash={setForeignCash}
          usdKrw={USD_KRW}
        />
      )}

      <footer>
        <strong>포스코증권 모의투자</strong>
        <span>본 화면은 학습용 가상 증권 서비스이며 실제 금융회사·실제 주문 시스템과 연결되어 있지 않습니다. 모든 시세는 임의 생성 데이터입니다.</span>
      </footer>
    </div>
  );
}
