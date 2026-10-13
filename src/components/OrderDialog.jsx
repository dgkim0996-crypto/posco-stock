import React, { useEffect, useRef, useState } from "react";
import { getPriceStep, validateLimitPrice, validateOrderQuantity } from "../../shared/tradingRules.js";
import "./OrderDialog.css";

const amount = (value) => `${Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
const price = (value, asset) => `${asset.unit === "USD" ? "$" : ""}${Number(value).toLocaleString("ko-KR", { maximumFractionDigits: asset.unit === "KRW" && Number(value) >= 1 ? 0 : 8 })}${asset.unit === "KRW" ? "원" : ""}`;

/** 주문 내용은 열 때 캡처하고, 서버의 처리 결과가 도착할 때까지 중복 전송을 막는다. */
export default function OrderDialog({ draft, busy, onClose, onSubmit }) {
  const dialogRef = useRef(null);
  const submitLock = useRef(false);
  const [quantity, setQuantity] = useState(String(draft.quantity));
  const [limitPrice, setLimitPrice] = useState(String(draft.price));
  const [error, setError] = useState("");
  const isAmend = draft.action === "amend";
  const isCancel = draft.action === "cancel";
  const direction = draft.side === "BUY" ? "매수" : "매도";
  const title = isAmend ? "미체결 주문 정정" : isCancel ? "미체결 주문 취소" : `${direction} 주문 확인`;

  useEffect(() => {
    const element = dialogRef.current;
    element.showModal();
    return () => element.close();
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (busy || submitLock.current) return;
    if (isAmend) {
      const qty = Number(quantity);
      const message = validateOrderQuantity(draft.category, qty) || validateLimitPrice({ ...draft.asset, category: draft.category }, Number(limitPrice));
      if (message) { setError(message); return; }
    }
    submitLock.current = true;
    setError("");
    try {
      await onSubmit({ quantity: Number(quantity), limitPrice: Number(limitPrice) });
    } catch (failure) {
      setError(failure.message || "주문 처리에 실패했습니다. 내역을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      submitLock.current = false;
    }
  }

  return <dialog className="broker-order-dialog" ref={dialogRef} aria-labelledby="broker-order-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <header><span>모의계좌 · {draft.accountNumber}</span><button type="button" disabled={busy} onClick={onClose} aria-label="주문 확인 닫기">×</button></header>
      <h2 id="broker-order-dialog-title">{title}</h2>
      <div className="broker-dialog-security"><strong>{draft.asset.name}</strong><span>{draft.asset.symbol} · {draft.asset.market || draft.category}</span><b className={draft.side === "BUY" ? "up" : "down"}>{direction}</b></div>
      <dl>
        <div><dt>주문구분</dt><dd>{draft.orderType === "LIMIT" ? "지정가" : "시장가"}</dd></div>
        {isAmend ? <>
          <div><dt><label htmlFor="amend-order-price">정정 가격</label></dt><dd><input autoFocus id="amend-order-price" type="number" min={getPriceStep(draft.asset, Number(limitPrice))} step="any" value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} disabled={busy} required /></dd></div>
          <div><dt><label htmlFor="amend-order-quantity">정정 잔여수량</label></dt><dd><input id="amend-order-quantity" type="number" min={draft.category === "crypto" ? "0.00000001" : "1"} step={draft.category === "crypto" ? "0.00000001" : "1"} value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy} required /></dd></div>
        </> : <>
          <div><dt>{isCancel ? "취소 잔여수량" : "주문수량"}</dt><dd>{Number(draft.quantity).toLocaleString("ko-KR", { maximumFractionDigits: 8 })}{draft.category === "futures" ? "계약" : draft.category === "crypto" ? "개" : "주"}</dd></div>
          <div><dt>{draft.orderType === "MARKET" ? "참고 현재가" : "주문가격"}</dt><dd>{price(draft.price, draft.asset)}</dd></div>
        </>}
        {!isAmend && !isCancel && <>
          <div><dt>{draft.category === "futures" ? "필요 증거금 예상" : "주문금액 예상"}</dt><dd>{amount(draft.grossAmount)}</dd></div>
          {draft.category !== "futures" && <div><dt>수수료·세금 예상</dt><dd>{amount(draft.charges)}</dd></div>}
          <div className="broker-dialog-total"><dt>{draft.category === "futures" ? "증거금 차감 예상" : draft.side === "BUY" ? "총 차감 예상" : "순입금 예상"}</dt><dd>{amount(draft.totalAmount)}</dd></div>
        </>}
      </dl>
      <p className="broker-dialog-note">{isAmend ? "이미 체결된 수량은 유지하며, 남은 주문의 가격과 수량만 변경합니다. 정정하면 예약금이 다시 계산됩니다." : isCancel ? "아직 체결되지 않은 수량만 취소합니다. 이미 체결된 거래는 유지되며 취소 완료 후 예약금 또는 수량이 해제됩니다." : draft.orderType === "MARKET" ? "시장가 주문은 서버가 확인한 시세로 모의 체결되어 예상 금액과 달라질 수 있습니다." : "지정가로 접수한 뒤 가격 조건을 충족하면 모의 부분체결됩니다. 장 시간과 관계없이 접수하며, 취소 전까지 유지됩니다."}</p>
      {error && <p className="broker-dialog-error" role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>돌아가기</button><button type="submit" disabled={busy} className={draft.side === "BUY" && !isCancel ? "buy" : "sell"}>{busy ? "처리 중…" : isAmend ? "정정 접수" : isCancel ? "잔여수량 취소" : `${direction} 주문 확정`}</button></footer>
    </form>
  </dialog>;
}
