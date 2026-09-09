import React, { useState } from "react";
import { apiFetch } from "../utils/api.js";

function won(value) { return `${Math.round(value).toLocaleString()}원`; }

const PRODUCTS = {
  credit: { icon: "신", title: "신용융자", description: "예수금 기반 신용 매수자금", rate: "연 7.5%" },
  margin: { icon: "미", title: "미수거래", description: "결제일까지 사용하는 매수자금", rate: "결제일 D+2" },
  lending: { icon: "대", title: "대주거래", description: "현금·주식자산 기반 대주한도", rate: "담보율 40%" },
  collateral: { icon: "담", title: "주식담보대출", description: "보유주식 평가액 기반 대출", rate: "연 6.8%" },
};

export default function Banking({ cash, setCash, foreignCash, setForeignCash, usdKrw, stockValue, financeAccount, setFinanceAccount, lendingUsed }) {
  const [mode, setMode] = useState("transfer");
  const [amount, setAmount] = useState("100000");
  const [recipient, setRecipient] = useState("포스코은행 123-456-789012");
  const [message, setMessage] = useState("계좌 잔고와 연결된 모의 금융업무를 이용할 수 있습니다.");
  const [logs, setLogs] = useState([]);
  const [financeProduct, setFinanceProduct] = useState("credit");
  const [financeAmount, setFinanceAmount] = useState("1000000");
  const [riskAccepted, setRiskAccepted] = useState(false);

  function addLog(type, text) {
    setLogs((prev) => [{ id: crypto.randomUUID(), time: new Date().toLocaleTimeString("ko-KR"), type, text }, ...prev].slice(0, 12));
  }
  function inputAmount() { return Number(String(amount).replaceAll(",", "")); }
  async function applyCash(operation, value) {
    const response=await apiFetch("/api/accounts/me/cash",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({operation,amount:value})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||"계좌 처리 실패");setCash(result.account.krwBalance);setForeignCash(result.account.usdBalance);return result;
  }
  async function transfer() {
    const value = inputAmount();
    if (!recipient.trim() || !Number.isFinite(value) || value <= 0) { setMessage("계좌와 금액을 확인해 주세요."); return; }
    if (value > cash) { setMessage("이체 가능한 원화 예수금이 부족합니다."); return; }
    try{await applyCash("TRANSFER_KRW",value);addLog("이체",`${won(value)} · ${recipient.trim()}`);setMessage(`${won(value)} 모의 이체가 완료되었습니다.`);}catch(error){setMessage(error.message);}
  }
  async function deposit() {
    const value = inputAmount();
    if (!Number.isFinite(value) || value <= 0) { setMessage("입금액을 확인해 주세요."); return; }
    try{await applyCash("DEPOSIT_KRW",value);addLog("입금",won(value));setMessage(`${won(value)} 모의 입금이 완료되었습니다.`);}catch(error){setMessage(error.message);}
  }
  async function exchangeToUsd() {
    const value = inputAmount();
    if (!Number.isFinite(value) || value <= 0 || value > cash) { setMessage("환전할 원화 금액을 확인해 주세요."); return; }
    try{await applyCash("EXCHANGE_TO_USD",value);const usd=value/usdKrw;addLog("환전",`${won(value)} → $${usd.toFixed(2)}`);setMessage("달러 환전이 완료되었습니다.");}catch(error){setMessage(error.message);}
  }
  async function exchangeToKrw() {
    const usd = inputAmount();
    if (!Number.isFinite(usd) || usd <= 0 || usd > foreignCash) { setMessage("환전할 USD 금액을 확인해 주세요."); return; }
    try{await applyCash("EXCHANGE_TO_KRW",usd);const krw=usd*usdKrw;addLog("환전",`$${usd.toFixed(2)} → ${won(krw)}`);setMessage("원화 환전이 완료되었습니다.");}catch(error){setMessage(error.message);}
  }

  function maximumFor(key) {
    if (key === "credit") return Math.floor(cash * 2);
    if (key === "margin") return Math.floor(cash * 0.4);
    if (key === "collateral") return Math.floor(stockValue * 0.7);
    return Math.floor(cash + stockValue);
  }

  async function executeFinance() {
    const product = PRODUCTS[financeProduct];
    const value = Number(financeAmount);
    const maximum = maximumFor(financeProduct);
    if (financeAccount[financeProduct].active) { setMessage("이미 실행 중입니다. 먼저 상환 또는 담보 해제를 진행해 주세요."); return; }
    if (!Number.isFinite(value) || value < 100000) { setMessage("실행금액은 10만원 이상이어야 합니다."); return; }
    if (value > maximum) { setMessage(`${product.title} 가능 금액 ${won(maximum)}를 초과했습니다.`); return; }
    if (!riskAccepted) { setMessage("위험고지와 모의 약관에 동의해 주세요."); return; }
    const locked = financeProduct === "lending" ? Math.ceil(value * 0.4) : 0;
    if (locked > cash) { setMessage(`필요 대주 담보금 ${won(locked)}보다 예수금이 부족합니다.`); return; }

    try{const response=await apiFetch(`/api/accounts/me/finance/${financeProduct}/execute`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({amount:value})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"금융 실행 실패");setCash(payload.account.krwBalance);setFinanceAccount((prev)=>({...prev,[financeProduct]:payload.contract}));const result=financeProduct==="lending"?`한도 ${won(value)} · 담보금 ${won(payload.contract.locked)} 예치`:`${won(value)} 실행 · 현금 및 부채 반영`;addLog("금융",`${product.title} · ${result}`);setMessage(`${product.title} ${result}`);setRiskAccepted(false);}catch(error){setMessage(error.message);}
  }

  async function settleFinance() {
    const product = PRODUCTS[financeProduct];
    const current = financeAccount[financeProduct];
    if (!current.active) return;
    try{const response=await apiFetch(`/api/accounts/me/finance/${financeProduct}/settle`,{method:"POST"});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"상환 실패");setCash(payload.account.krwBalance);setFinanceAccount((prev)=>({...prev,[financeProduct]:payload.contract}));setMessage(financeProduct==="lending"?`대주 한도를 해지하고 담보금 ${won(current.locked)}을 반환했습니다.`:`${product.title} ${won(current.debt)}을 전액 상환했습니다.`);addLog("상환",product.title);}catch(error){setMessage(error.message);}
  }

  const product = PRODUCTS[financeProduct];
  const current = financeAccount[financeProduct];
  const maximum = maximumFor(financeProduct);

  return (
    <section className="service-page banking-page">
      <div className="service-hero"><div><span className="service-kicker">BANKING · SERVICE</span><h1>이체와 계좌업무를 한곳에서</h1><p>모의 예수금과 보유주식에 연결된 금융업무를 체험할 수 있습니다.</p></div><div className="bank-balance"><span>원화 주문가능</span><strong>{won(cash)}</strong><em>보유주식 {won(stockValue)}</em></div></div>

      <div className="bank-quick-grid">
        {[["transfer", "↗", "이체", "다른 계좌로 보내기"], ["deposit", "＋", "입금", "모의 예수금 충전"], ["exchange", "＄", "환전", "KRW ↔ USD"], ["account", "▣", "계좌관리", "정보·증명서·설정"]].map(([key, icon, title, desc]) => <button type="button" key={key} onClick={() => setMode(key)} className={mode === key ? "active" : ""}><i>{icon}</i><span><strong>{title}</strong><em>{desc}</em></span></button>)}
      </div>

      <div className="service-two-col banking-main-grid">
        <article className="service-card banking-work-card">
          {mode === "transfer" && <><div className="service-card-head"><div><span>빠른이체</span><strong>모의 계좌이체</strong></div></div><div className="bank-form"><label><span>받는계좌</span><input value={recipient} onChange={(e) => setRecipient(e.target.value)} /></label><label><span>이체금액</span><div className="amount-input"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /><b>원</b></div></label><button className="primary-action wide" onClick={transfer}>모의 이체하기</button></div></>}
          {mode === "deposit" && <><div className="service-card-head"><div><span>입금</span><strong>모의 예수금 충전</strong></div></div><div className="bank-form"><label><span>입금액</span><div className="amount-input"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /><b>원</b></div></label><button className="primary-action wide" onClick={deposit}>모의 입금하기</button></div></>}
          {mode === "exchange" && <><div className="service-card-head"><div><span>외화</span><strong>원화 ↔ 달러 환전</strong></div><em>$1 = {usdKrw.toLocaleString()}원</em></div><div className="exchange-balance"><div><span>KRW</span><strong>{won(cash)}</strong></div><div><span>USD</span><strong>${foreignCash.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div></div><div className="bank-form"><label><span>환전금액</span><div className="amount-input"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /><b>KRW / USD</b></div></label><div className="exchange-actions"><button className="primary-action" onClick={exchangeToUsd}>원화 → USD</button><button className="outline-action" onClick={exchangeToKrw}>USD → 원화</button></div></div></>}
          {mode === "account" && <><div className="service-card-head"><div><span>계좌관리</span><strong>모의 계좌 현황</strong></div></div><div className="exchange-balance"><div><span>현금</span><strong>{won(cash)}</strong></div><div><span>보유주식</span><strong>{won(stockValue)}</strong></div></div></>}
          <div className="bank-message"><b>처리 결과</b><span>{message}</span></div>
        </article>
        <article className="service-card banking-history-card"><div className="service-card-head"><div><span>최근 업무</span><strong>계좌 · 금융 처리내역</strong></div><button className="text-action" onClick={() => setLogs([])}>내역 지우기</button></div>{logs.length === 0 ? <div className="bank-empty"><span>↕</span><strong>최근 처리한 업무가 없습니다.</strong></div> : <div className="bank-log-list">{logs.map((log) => <div key={log.id}><span className="bank-log-type">{log.type}</span><span><strong>{log.text}</strong><em>{log.time}</em></span></div>)}</div>}</article>
      </div>

      <div className="service-card banking-shortcuts finance-center">
        <div className="service-card-head"><div><span>신용 · 대주 업무</span><strong>계좌 연동 금융업무</strong></div><em>모의투자 전용</em></div>
        <div className="finance-product-grid">{Object.entries(PRODUCTS).map(([key, item]) => <button type="button" key={key} className={`${financeProduct === key ? "selected" : ""} ${financeAccount[key].active ? "is-active" : ""}`} onClick={() => { setFinanceProduct(key); setRiskAccepted(false); }}><i>{item.icon}</i><span><strong>{item.title}</strong><em>{item.description}</em><b>{item.rate}</b></span><small>{financeAccount[key].active ? "실행중" : "실행"}</small></button>)}</div>
        <div className="finance-application"><div className="finance-summary"><span><i>{product.icon}</i><strong>{product.title}</strong><em>{product.description}</em></span><b className={current.active ? "active" : ""}>{current.active ? financeProduct === "lending" ? `대주잔고 ${won(lendingUsed)}` : `잔액 ${won(current.debt)}` : "미실행"}</b></div><div className="finance-form"><label><span>{financeProduct === "lending" ? "대주 한도" : "실행 금액"}</span><div className="amount-input"><input type="number" min="100000" step="100000" value={financeAmount} disabled={current.active} onChange={(event) => setFinanceAmount(event.target.value)} /><b>원</b></div><small>현재 계좌 기준 최대 {won(maximum)} · {financeProduct === "collateral" ? `보유주식 ${won(stockValue)}` : financeProduct === "lending" ? `사용 ${won(lendingUsed)} · 담보 ${won(current.locked)}` : "실행금은 현금과 부채에 동시 반영"}</small></label><label className="risk-check"><input type="checkbox" checked={riskAccepted} disabled={current.active} onChange={(event) => setRiskAccepted(event.target.checked)} /><span>원금 초과 손실과 반대매매 위험을 확인했습니다.</span></label><div className="finance-actions">{current.active ? <button type="button" className="outline-action" onClick={settleFinance}>{financeProduct === "lending" ? "담보 해제" : "전액 상환"}</button> : <button type="button" className="primary-action" onClick={executeFinance}>계좌에 실행</button>}</div></div></div>
        <p className="finance-notice">실행금·부채·대주 담보금은 주문가능금액과 순자산에 즉시 반영됩니다. 실제 금융거래는 발생하지 않습니다.</p>
      </div>
    </section>
  );
}
