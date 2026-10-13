import { apiFetch } from "../../utils/api.js";
import { SIMULATED_USD_KRW as USD_KRW } from "../../../shared/tradingRules.js";
import { ORDER_CATEGORY_LABELS } from "../market/marketConstants.js";
import { assetPrice } from "../../utils/tradingFormatters.js";
import { spotPriceInKRW, isStockCategory } from "../market/marketHelpers.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useSpotOrders({
  setFilledOrders, allAssets, setCash, setSpotPositions, setShortPositions, pushTrade, notifyOrder,
  pendingOrders, spotPositions, category, financeAccount, lendingUsed, setPendingOrders, setOrderTab,
}) {
  function addFilledOrder(order, executionPrice) {
    setFilledOrders((prev) => [{
      ...order,
      status: "FILLED",
      executionPrice,
      filledAtTime: Date.now(),
      filledAt: new Date().toLocaleTimeString("ko-KR"),
    }, ...prev].slice(0, 40));
  }

  async function executeSpotOrder(order, executionPrice, fillQuantity = null) {
    const asset = allAssets.find((item) => item.id === order.assetId);
    if (!asset) return false;
    try {
      const response=await apiFetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clientOrderId:order.clientOrderId,symbol:order.symbol,side:order.side,quantity:order.quantity,orderType:order.orderType,requestedPrice:order.limitPrice,pendingOrderId:order.pendingOrderId||null,fillQuantity})});
      const result=await response.json(); if(!response.ok)throw new Error(result.error||"주문 처리 실패");
      setCash(result.account.krwBalance);
      setSpotPositions((prev)=>{const next={...prev};if(result.holding)next[asset.id]={quantity:result.holding.quantity,avgPrice:result.holding.avgPrice,type:result.holding.category};else delete next[asset.id];return next;});
      setShortPositions((prev)=>{const next={...prev};if(result.shortPosition)next[asset.id]={quantity:result.shortPosition.quantity,avgPrice:result.shortPosition.avgPrice};else delete next[asset.id];return next;});
      const nativeExecutionPrice=asset.unit==="USD"?result.order.price/USD_KRW:result.order.price;
      const completed=result.order.status==="FILLED";
      const executedQuantity=fillQuantity ?? order.quantity;
      if(completed)addFilledOrder({
        ...order,
        id:result.order.id,
        quantity:result.order.filledQuantity,
        feeAmount:result.order.feeAmount,
        taxAmount:result.order.taxAmount,
        transactionTaxAmount:result.order.transactionTaxAmount,
        agriculturalTaxAmount:result.order.agriculturalTaxAmount,
      },nativeExecutionPrice);
      pushTrade(`${ORDER_CATEGORY_LABELS[order.category]} · ${asset.name} ${executedQuantity} ${order.side==="BUY"?"매수":"매도"} · ${assetPrice({...asset,price:nativeExecutionPrice})}`);
      notifyOrder(
        completed
          ? `${asset.name} ${result.order.filledQuantity} ${order.side === "BUY" ? "매수" : "매도"} 전량 체결`
          : `${asset.name} ${executedQuantity} 부분체결 · 잔여 ${result.order.remainingQuantity}`,
        completed ? "success" : "info",
        completed ? "주문이 체결됐어요" : "주문이 부분 체결됐어요",
      );
      return {completed,remainingQuantity:result.order.remainingQuantity};
    } catch(error) {
      notifyOrder(`${asset.name} 주문 실패 · ${error.message}`, "error", "주문을 처리하지 못했어요");
      return null;
    }
  }

  async function placeSpotOrder(side, draft) {
    const selected = draft.asset;
    const orderType = draft.orderType;
    const qty = draft.quantity;
    const requestedPrice = draft.price;
    if (!Number.isFinite(qty) || qty <= 0) {
      notifyOrder("주문 수량을 0보다 크게 입력해 주세요.", "warning", "주문 내용을 확인해 주세요");
      throw new Error("주문 수량이 올바르지 않습니다.");
    }
    if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
      notifyOrder("지정가를 0보다 크게 입력해 주세요.", "warning", "주문 내용을 확인해 주세요");
      throw new Error("주문가격이 올바르지 않습니다.");
    }
    const reservedSellQuantity = pendingOrders
      .filter((item) => item.assetId === selected.id && item.side === "SELL")
      .reduce((sum, item) => sum + item.quantity, 0);
    if (side === "SELL") {
      const ownedQuantity = spotPositions[selected.id]?.quantity ?? 0;
      const shortQuantity = Math.max(0, reservedSellQuantity + qty - ownedQuantity);
      const shortAmount = spotPriceInKRW({ ...selected, price: requestedPrice }) * shortQuantity;
      if (shortQuantity > 0 && (!isStockCategory(category) || !financeAccount.lending.active)) {
        notifyOrder("보유수량 초과 매도에는 대주거래 실행이 필요합니다.", "warning", "매도 주문이 불가능해요");
        throw new Error("매도가능수량이 부족합니다.");
      }
      if (shortQuantity > 0 && lendingUsed + shortAmount > financeAccount.lending.limit) {
        notifyOrder("미체결 주문을 포함한 대주매도 금액이 대주한도를 초과합니다.", "warning", "매도 주문이 불가능해요");
        throw new Error("대주한도가 부족합니다.");
      }
    }

    const order = {
      id: draft.clientOrderId,
      clientOrderId: draft.clientOrderId,
      assetId: selected.id,
      symbol: selected.symbol,
      name: selected.name,
      category: draft.category,
      side,
      orderType,
      quantity: qty,
      limitPrice: orderType === "LIMIT" ? requestedPrice : null,
      orderedAt: new Date().toLocaleTimeString("ko-KR"),
    };
    if (orderType === "MARKET") {
      const result = await executeSpotOrder(order, selected.price);
      if (!result) throw new Error("주문을 완료하지 못했습니다. 주문 내역을 확인한 뒤 다시 시도해 주세요.");
    } else {
      try {
        const response=await apiFetch("/api/accounts/me/pending-orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clientOrderId:draft.clientOrderId,symbol:selected.symbol,side,quantity:qty,limitPrice:requestedPrice})});
        const saved=await response.json();if(!response.ok)throw new Error(saved.error||"지정가 주문 저장 실패");
        setPendingOrders((prev)=>[{...order,id:saved.id,pendingOrderId:saved.id,orderId:saved.orderId||null,createdAt:saved.createdAt},...prev]);
        notifyOrder(`${selected.name} ${qty} ${side === "BUY" ? "매수" : "매도"} 지정가 주문 접수`, "info", "지정가 주문을 접수했어요");
        setOrderTab("pending");
      } catch(error){notifyOrder(`${selected.name} 지정가 주문 실패 · ${error.message}`, "error", "주문을 접수하지 못했어요"); throw error;}
    }
  }

  async function cancelPendingOrder(order) {
    try {
      const response=await apiFetch(`/api/accounts/me/pending-orders/${order.pendingOrderId||order.id}`,{method:"DELETE"});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"주문 취소 실패");
      setPendingOrders((prev)=>prev.filter((item)=>item.id!==order.id));
      notifyOrder(`${order.name} 지정가 주문을 취소했습니다.`, "info", "주문을 취소했어요");
    } catch(error){notifyOrder(`${order.name} 주문 취소 실패 · ${error.message}`, "error", "주문을 취소하지 못했어요"); throw error;}
  }

  async function amendPendingOrder(order, values) {
    const nextQuantity = values.quantity;
    const nextLimitPrice = values.limitPrice;
    // 정정 창을 연 시점의 잔량. 그 사이 부분체결되었으면 서버가 409로 거부해 총주문수량이 늘지 않는다.
    const expectedRemaining = values.expectedRemaining ?? order.quantity;
    try {
      const response = await apiFetch(`/api/accounts/me/pending-orders/${order.pendingOrderId || order.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: nextQuantity, limitPrice: nextLimitPrice, expectedRemaining }) });
      const saved = await response.json(); if (!response.ok) throw Object.assign(new Error(saved.error || "주문 정정 실패"), { status: response.status });
      setPendingOrders((prev) => prev.map((item) => item.id === order.id ? { ...item, quantity: saved.quantity, limitPrice: saved.limitPrice } : item));
      notifyOrder(`${order.name} 지정가 주문을 정정했습니다.`, "info", "주문을 정정했어요");
    } catch (error) {
      if (error.status === 409) notifyOrder(`${order.name} 주문 잔량이 바뀌었습니다. 최신 미체결 내역을 다시 확인한 뒤 정정해 주세요.`, "warning", "주문 잔량이 바뀌었어요");
      else notifyOrder(`${order.name} 주문 정정 실패 · ${error.message}`, "error", "주문을 정정하지 못했어요");
      throw error;
    }
  }

  return {
    addFilledOrder, placeSpotOrder, cancelPendingOrder, amendPendingOrder,
  };
}
