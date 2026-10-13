import { useState, useEffect } from "react";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useOrderInput() {
  const [orderTab, setOrderTab] = useState("order");

  const [orderSide, setOrderSide] = useState("BUY");

  const [orderType, setOrderType] = useState("MARKET");

  const [limitPrice, setLimitPrice] = useState("");

  const [orderDialog, setOrderDialog] = useState(null);

  const [orderBusy, setOrderBusy] = useState(false);

  const [busyOrderId, setBusyOrderId] = useState(null);

  const [marketClock, setMarketClock] = useState(() => new Date());

  const [quantity, setQuantity] = useState("1");

  useEffect(() => {
    const timer = window.setInterval(() => setMarketClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return {
    orderTab, setOrderTab, orderSide, setOrderSide, orderType, setOrderType, limitPrice, setLimitPrice,
    orderDialog, setOrderDialog, orderBusy, setOrderBusy, busyOrderId, setBusyOrderId, marketClock,
    quantity, setQuantity,
  };
}
