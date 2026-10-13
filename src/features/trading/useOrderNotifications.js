import { useState, useRef, useEffect } from "react";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useOrderNotifications() {
  const [trades, setTrades] = useState([]);

  const [message, setMessage] = useState("포스코증권 모의투자 계좌가 준비되었습니다.");

  const [orderToasts, setOrderToasts] = useState([]);

  const orderToastTimers = useRef(new Map());

  useEffect(() => () => {
    orderToastTimers.current.forEach((timer) => window.clearTimeout(timer));
    orderToastTimers.current.clear();
  }, []);

  function pushTrade(text) {
    setTrades((prev) => [
      { id: crypto.randomUUID(), time: new Date().toLocaleTimeString("ko-KR"), text },
      ...prev,
    ].slice(0, 40));
  }

  function notifyOrder(text, tone = "info", title = "주문 안내") {
    setMessage(text);
    const id = crypto.randomUUID();
    setOrderToasts((prev) => [{ id, tone, title, text }, ...prev].slice(0, 4));
    const timer = window.setTimeout(() => {
      setOrderToasts((prev) => prev.filter((toast) => toast.id !== id));
      orderToastTimers.current.delete(id);
    }, 4800);
    orderToastTimers.current.set(id, timer);
  }

  function dismissOrderToast(id) {
    const timer = orderToastTimers.current.get(id);
    if (timer) window.clearTimeout(timer);
    orderToastTimers.current.delete(id);
    setOrderToasts((prev) => prev.filter((toast) => toast.id !== id));
  }

  return {
    trades, setTrades, message, setMessage, orderToasts, pushTrade, notifyOrder, dismissOrderToast,
  };
}
