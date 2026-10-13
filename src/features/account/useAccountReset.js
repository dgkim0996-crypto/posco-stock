import { apiFetch } from "../../utils/api.js";
import { cloneMarkets } from "../market/marketStorage.js";
import { INITIAL_MARKETS } from "../../data/markets.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useAccountReset({
  orderMutationLock, accountRequestVersion, setOrderBusy, setMarkets, setCash, setForeignCash,
  setFinanceAccount, setSpotPositions, setShortPositions, setFuturesPositions, setTrades,
  setPendingOrders, setFilledOrders, setAccountOrders, setOrderTab, setOrderSide, setOrderType,
  setLimitPrice, setChartData, setCategory, setSelectedId, setQuantity, setMessage, refreshAccount,
}) {
  async function reset() {
    if (orderMutationLock.current || !window.confirm("모의계좌의 주문·체결·보유잔고를 초기화하고 예수금을 1,000만원으로 되돌릴까요?")) return;
    orderMutationLock.current = true;
    accountRequestVersion.current += 1;
    setOrderBusy(true);
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
    setAccountOrders([]);
    setOrderTab("order");
    setOrderSide("BUY");
    setOrderType("MARKET");
    setLimitPrice("");
    setChartData({});
    setCategory("domesticStocks");
    setSelectedId(INITIAL_MARKETS.stocks[0].id);
    setQuantity("1");
      setMessage("모의투자 계좌가 초기화되었습니다.");
    } catch (error) {
      setMessage(`계좌 초기화 실패 · ${error.message}`);
    } finally {
      await refreshAccount({ afterMutation: true });
      orderMutationLock.current = false;
      setOrderBusy(false);
    }
  }

  return {
    reset,
  };
}
