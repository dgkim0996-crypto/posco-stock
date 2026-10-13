import { useState, useEffect } from "react";
import { isStockCategory } from "./marketHelpers.js";
import { websocketUrl } from "../../utils/api.js";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// 서버 재시작 때 모든 탭이 같은 순간 재접속하지 않도록 지수 백오프에 무작위 지터를 더한다.
export function realtimeReconnectDelay(attempt, random = Math.random) {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.max(0, attempt)));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useRealtimeQuote({
  category, selected, setMarkets,
}) {
  const [realtimeStatus, setRealtimeStatus] = useState({ connected: false, updatedAt: null });

  const [orderBook, setOrderBook] = useState(null);

  useEffect(() => {
    setOrderBook(null);
    if (!isStockCategory(category) || selected?.unit !== "KRW" || selected?.market === "SIM") {
      setRealtimeStatus({ connected: false, updatedAt: null });
      return undefined;
    }
    let active = true;
    let reconnectTimer;
    let reconnectAttempts = 0;
    let socket;
    const connect = () => {
      socket = new WebSocket(websocketUrl("/ws/market"));
      socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "subscribe", symbol: selected.symbol })));
      socket.addEventListener("message", (event) => {
        if (!active) return;
        // 연결 직후 거절되는 경우와 구분하도록 서버 메시지를 받은 뒤에만 백오프를 초기화한다.
        reconnectAttempts = 0;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "status") setRealtimeStatus((current) => ({ ...current, connected: Boolean(message.data?.connected) }));
          if (message.type === "quote" && message.data?.symbol === selected.symbol) {
            const quote = message.data;
            setMarkets((current) => ({ ...current, stocks: current.stocks.map((asset) => asset.symbol === quote.symbol ? {
              ...asset, price: quote.price, changeAmount: quote.changeAmount ?? asset.changeAmount, change: quote.change ?? asset.change, open: quote.open ?? asset.open,
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
        reconnectTimer = window.setTimeout(connect, realtimeReconnectDelay(reconnectAttempts));
        reconnectAttempts += 1;
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

  return {
    realtimeStatus, orderBook,
  };
}
