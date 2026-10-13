import { validateOrderQuantity, validateLimitPrice } from "../../../shared/tradingRules.js";
import { isStockCategory } from "../market/marketHelpers.js";

// crypto.randomUUID는 HTTPS·localhost 같은 보안 컨텍스트에서만 제공된다. LAN IP(http)로 접속해도
// 주문 확인이 막히지 않도록 어디서나 제공되는 getRandomValues로 RFC 4122 v4 UUID를 만든다.
export function createClientOrderId(source = globalThis.crypto) {
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useOrderReview({
  accountReady, accountLoading, orderMutationLock, quantity, orderType, category, limitPrice, selected,
  marketCategory, orderTaxPreview, orderSide, orderAvailability, financeAccount, notifyOrder,
  setOrderDialog, accountNumber, allAssets, orderDialog, accountRequestVersion, setOrderBusy,
  setBusyOrderId, amendPendingOrder, cancelPendingOrder, openFuture, placeSpotOrder, refreshAccount,
}) {
  function reviewOrder() {
    if (!accountReady || accountLoading || orderMutationLock.current) return;
    const qty = Number(quantity);
    const requestedPrice = orderType === "LIMIT" && category !== "futures" ? Number(limitPrice) : selected.price;
    let error = validateOrderQuantity(category, qty);
    if (!error && orderType === "LIMIT" && category !== "futures") error = validateLimitPrice({ ...selected, category: marketCategory }, requestedPrice);
    const grossAmount = category === "futures" ? requestedPrice * selected.multiplier * selected.marginRate * qty : orderTaxPreview.grossAmount;
    const totalAmount = category === "futures" ? grossAmount : Math.abs(orderTaxPreview.settlementAmount);
    if (!error && (orderSide === "BUY" || category === "futures") && totalAmount > orderAvailability.availableCash) error = "미체결 예약금과 수수료를 제외한 주문가능금액이 부족합니다.";
    if (!error && orderSide === "SELL" && category !== "futures" && !(isStockCategory(category) && financeAccount.lending.active) && qty > orderAvailability.availableSellQuantity) error = "미체결 매도 주문을 제외한 매도가능수량이 부족합니다.";
    if (error) { notifyOrder(error, "warning", "주문 내용을 확인해 주세요"); return; }
    setOrderDialog({ action: "create", clientOrderId: createClientOrderId(), accountNumber, asset: { ...selected }, category: marketCategory, side: orderSide, orderType: category === "futures" ? "MARKET" : orderType, quantity: qty, price: requestedPrice, grossAmount, charges: orderTaxPreview.feeAmount + orderTaxPreview.immediateTaxAmount, totalAmount });
  }

  function reviewPendingOrder(action, order) {
    if (orderMutationLock.current || !accountReady || accountLoading) return;
    const asset = allAssets.find((item) => item.symbol === order.symbol);
    if (!asset) return;
    setOrderDialog({ action, order, accountNumber, asset: { ...asset }, category: order.category, side: order.side, orderType: "LIMIT", quantity: order.quantity, price: order.limitPrice });
  }

  async function submitReviewedOrder(values) {
    if (orderMutationLock.current || !orderDialog) return;
    orderMutationLock.current = true;
    accountRequestVersion.current += 1;
    setOrderBusy(true);
    setBusyOrderId(orderDialog.order?.id || null);
    try {
      // 정정 창을 연 시점의 잔량을 함께 보내 그 사이 부분체결되었으면 서버가 409로 거부하게 한다.
      if (orderDialog.action === "amend") await amendPendingOrder(orderDialog.order, { ...values, expectedRemaining: orderDialog.order.quantity });
      else if (orderDialog.action === "cancel") await cancelPendingOrder(orderDialog.order);
      else if (orderDialog.category === "futures") await openFuture(orderDialog.side === "BUY" ? "LONG" : "SHORT", orderDialog.quantity, orderDialog.asset);
      else await placeSpotOrder(orderDialog.side, orderDialog);
      setOrderDialog(null);
      await refreshAccount({ afterMutation: true });
    } catch (error) {
      await refreshAccount({ afterMutation: true });
      // 잔량이 바뀐 정정 창은 이전 잔량을 계속 보내므로 닫고, 재조회한 미체결 내역에서 다시 열게 한다.
      if (orderDialog.action === "amend" && error.status === 409) setOrderDialog(null);
      throw error;
    } finally {
      orderMutationLock.current = false;
      setOrderBusy(false);
      setBusyOrderId(null);
    }
  }

  return {
    reviewOrder, reviewPendingOrder, submitReviewedOrder,
  };
}
