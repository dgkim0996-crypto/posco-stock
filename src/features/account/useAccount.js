import { useState, useRef, useEffect } from "react";
import { STARTING_CASH } from "../trading/tradingConstants.js";
import { apiFetch } from "../../utils/api.js";
import { INITIAL_MARKETS } from "../../data/markets.js";
import { SIMULATED_USD_KRW as USD_KRW } from "../../../shared/tradingRules.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useAccount({
  mainTab, notifyOrder, setMessage,
}) {
  const [foreignCash, setForeignCash] = useState(0);

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

  const [pendingOrders, setPendingOrders] = useState([]);

  const [filledOrders, setFilledOrders] = useState([]);

  const [accountOrders, setAccountOrders] = useState([]);

  const [accountReady, setAccountReady] = useState(false);

  const [accountLoading, setAccountLoading] = useState(false);

  const [accountError, setAccountError] = useState("");

  const [matchingStatus, setMatchingStatus] = useState(null);

  const orderMutationLock = useRef(false);

  const accountRequestVersion = useRef(0);

  const accountReadLock = useRef(false);

  const previousOrderStates = useRef(new Map());

  const [ledgerEntries, setLedgerEntries] = useState([]);

  const [orderEvents, setOrderEvents] = useState([]);

  const [settlements, setSettlements] = useState([]);

  const [riskStatus, setRiskStatus] = useState(null);

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

  async function refreshAccount({ afterMutation = false, silent = false } = {}) {
    if (!afterMutation && (orderMutationLock.current || accountReadLock.current)) return;
    accountReadLock.current = true;
    const version = ++accountRequestVersion.current;
    if (!silent) setAccountLoading(true);
    try {
      const response = await apiFetch("/api/accounts/me/state");
      const state = await response.json();
      if (!response.ok) throw new Error(state.error || "계좌 상태 조회 실패");
      if (version !== accountRequestVersion.current) return;
      setAccountNumber(state.account.accountNumber); setCash(state.account.krwBalance); setForeignCash(state.account.usdBalance); setFinanceAccount(state.finance);
      setSpotPositions(Object.fromEntries(state.holdings.map((item)=>[item.symbol,{quantity:item.quantity,avgPrice:item.avgPrice,type:item.category}])));
      setShortPositions(Object.fromEntries(state.shortPositions.map((item)=>[item.symbol,{quantity:item.quantity,avgPrice:item.avgPrice}])));
      setFuturesPositions(state.futuresPositions.map((item)=>{const asset=INITIAL_MARKETS.futures.find((candidate)=>candidate.symbol===item.symbol);return{...item,assetId:item.symbol,name:asset?.name||item.symbol};}));
      setAccountOrders(state.orders);
      setMatchingStatus(state.matching || null);
      for (const order of state.orders) {
        const previous = previousOrderStates.current.get(order.id);
        if (silent && previous && Number(order.filledQuantity) > previous.filledQuantity) {
          const asset = INITIAL_MARKETS[order.category]?.find((item) => item.symbol === order.symbol);
          notifyOrder(`${asset?.name || order.symbol} ${Number(order.filledQuantity) - previous.filledQuantity} ${order.side === "BUY" ? "매수" : "매도"} 체결 · 잔여 ${order.remainingQuantity || 0}`, "success", order.status === "FILLED" ? "전량 체결" : "부분 체결");
        }
      }
      previousOrderStates.current = new Map(state.orders.map((order) => [order.id, { filledQuantity: Number(order.filledQuantity) || 0, status: order.status }]));
      setFilledOrders(state.orders.filter((order)=>Number(order.filledQuantity)>0||order.status==="FILLED").map((order)=>{const asset=Object.values(INITIAL_MARKETS).flat().find((candidate)=>candidate.symbol===order.symbol);const filledDate=new Date(order.updatedAt||order.createdAt);return{...order,quantity:Number(order.filledQuantity)||order.quantity,assetId:order.symbol,name:asset?.name||order.symbol,executionPrice:asset?.unit==="USD"?order.executionPrice/USD_KRW:order.executionPrice,filledAtTime:filledDate.getTime(),filledAt:filledDate.toLocaleTimeString("ko-KR")};}));
      setPendingOrders(state.pendingOrders.map((order)=>{const asset=Object.values(INITIAL_MARKETS).flat().find((candidate)=>candidate.symbol===order.symbol);return{...order,pendingOrderId:order.id,assetId:order.symbol,name:asset?.name||order.symbol,orderType:"LIMIT",orderedAt:new Date(order.createdAt).toLocaleTimeString("ko-KR")};}));
      setAccountReady(true);
      setAccountError("");
    } catch (error) {
      if (version !== accountRequestVersion.current) return;
      setAccountReady(false);
      setAccountError(error.message);
      setMessage(`계좌 데이터 연결 실패 · ${error.message}`);
    } finally {
      if (version === accountRequestVersion.current) { accountReadLock.current = false; setAccountLoading(false); }
    }
  }

  useEffect(() => {
    refreshAccount();
    return () => { accountRequestVersion.current += 1; accountReadLock.current = false; };
  }, []);

  useEffect(() => {
    const sync = () => { if (document.visibilityState !== "hidden") refreshAccount({ silent: true }); };
    const timer = window.setInterval(sync, 5000);
    window.addEventListener("focus", sync);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", sync); };
  }, []);

  useEffect(() => {
    let active=true;let timer;
    const loadRisk=async()=>{try{const response=await apiFetch("/api/accounts/me/risk");const payload=await response.json();if(!response.ok)throw new Error(payload.error||"위험 평가 실패");if(!active)return;setRiskStatus(payload);if(payload.liquidations?.length){await refreshAccount({ silent: true });notifyOrder(`${payload.liquidations.length}개 선물 포지션이 유지증거금 미달로 강제청산됐습니다.`, "error", "포지션이 강제청산됐어요");}}catch{}finally{if(active)timer=window.setTimeout(loadRisk,10000);}};
    loadRisk();return()=>{active=false;window.clearTimeout(timer);};
  }, []);

  return {
    foreignCash, setForeignCash, cash, setCash, accountNumber, financeAccount, setFinanceAccount,
    spotPositions, setSpotPositions, shortPositions, setShortPositions, futuresPositions,
    setFuturesPositions, pendingOrders, setPendingOrders, filledOrders, setFilledOrders, accountOrders,
    setAccountOrders, accountReady, accountLoading, accountError, matchingStatus, orderMutationLock,
    accountRequestVersion, ledgerEntries, orderEvents, settlements, riskStatus, refreshAccount,
  };
}
