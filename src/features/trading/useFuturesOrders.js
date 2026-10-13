import { apiFetch } from "../../utils/api.js";
import { money } from "../../utils/tradingFormatters.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useFuturesOrders({
  notifyOrder, setCash, setFuturesPositions, addFilledOrder, category, pushTrade, futuresPositions,
  orderMutationLock, accountRequestVersion, setOrderBusy, refreshAccount,
}) {
  async function openFuture(side, qty, selected) {
    if (!Number.isFinite(qty) || qty < 1) {
      notifyOrder("선물 계약 수를 1 이상 입력해 주세요.", "warning", "주문 내용을 확인해 주세요");
      throw new Error("계약 수량이 올바르지 않습니다.");
    }

    try {
      const response=await apiFetch("/api/accounts/me/futures",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbol:selected.symbol,side,quantity:qty})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"선물 주문 실패");
      setCash(result.account.krwBalance);setFuturesPositions((prev)=>[...prev,{...result.position,assetId:selected.id,name:selected.name}]);
      addFilledOrder({id:result.position.id,assetId:selected.id,symbol:selected.symbol,name:selected.name,category,side:side==="LONG"?"BUY":"SELL",orderType:"MARKET",quantity:qty,limitPrice:null,orderedAt:new Date().toLocaleTimeString("ko-KR")},result.position.entryPrice);
      notifyOrder(`${selected.name} ${side === "LONG" ? "매수" : "매도"} ${qty}계약 체결`, "success", "선물 주문이 체결됐어요");
      pushTrade(`선물옵션 · ${selected.name} ${side} ${qty}계약 · ${result.position.entryPrice.toFixed(2)}`);
    } catch(error){notifyOrder(`${selected.name} 선물 주문 실패 · ${error.message}`, "error", "선물 주문을 처리하지 못했어요"); throw error;}
  }

  async function closeFuture(id) {
    const pos = futuresPositions.find((x) => x.id === id);
    if (!pos || orderMutationLock.current) return;
    orderMutationLock.current = true;
    accountRequestVersion.current += 1;
    setOrderBusy(true);

    try{const response=await apiFetch(`/api/accounts/me/futures/${id}/close`,{method:"POST"});const result=await response.json();if(!response.ok)throw new Error(result.error||"선물 청산 실패");const released=result.cancelledPendingOrders?.length||0;notifyOrder(`${pos.name} 청산 완료 · 손익 ${money(result.pnl)}${released?` · 손실 정산에 필요한 예약금만큼 미체결 매수 ${released}건 취소`:""}`, released ? "warning" : "success", "포지션을 청산했어요");pushTrade(`선물옵션 · ${pos.name} ${pos.side} 청산 · 손익 ${money(result.pnl)}`);}catch(error){notifyOrder(`${pos.name} 청산 실패 · ${error.message}`, "error", "포지션을 청산하지 못했어요");}
    finally { await refreshAccount({ afterMutation: true }); orderMutationLock.current = false; setOrderBusy(false); }
  }

  return {
    openFuture, closeFuture,
  };
}
