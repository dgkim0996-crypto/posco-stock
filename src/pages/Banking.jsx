import React, { useState } from "react";

function won(value){return `${Math.round(value).toLocaleString()}원`;}

export default function Banking({ cash, setCash, foreignCash, setForeignCash, usdKrw }) {
  const [mode,setMode] = useState("transfer");
  const [amount,setAmount] = useState("100000");
  const [recipient,setRecipient] = useState("포스코은행 123-456-789012");
  const [message,setMessage] = useState("모의 계좌에서 입출금·이체·환전을 체험할 수 있습니다.");
  const [logs,setLogs] = useState([]);

  function addLog(type,text){setLogs((prev)=>[{id:crypto.randomUUID(),time:new Date().toLocaleTimeString("ko-KR"),type,text},...prev].slice(0,12));}
  function num(){return Number(String(amount).replaceAll(",",""));}
  function transfer(){const value=num();if(!recipient.trim()){setMessage("받는 계좌를 입력해 주세요.");return;}if(!Number.isFinite(value)||value<=0){setMessage("금액을 올바르게 입력해 주세요.");return;}if(value>cash){setMessage("이체 가능한 원화 예수금이 부족합니다.");return;}setCash((prev)=>prev-value);setMessage(`${recipient.trim()} 계좌로 ${won(value)} 모의 이체가 완료되었습니다.`);addLog("이체",`${won(value)} · ${recipient.trim()}`);}
  function deposit(){const value=num();if(!Number.isFinite(value)||value<=0){setMessage("입금액을 올바르게 입력해 주세요.");return;}setCash((prev)=>prev+value);setMessage(`${won(value)} 모의 입금이 완료되었습니다.`);addLog("입금",won(value));}
  function exchangeToUsd(){const value=num();if(!Number.isFinite(value)||value<=0||value>cash){setMessage("환전할 원화 금액을 확인해 주세요.");return;}const usd=value/usdKrw;setCash((prev)=>prev-value);setForeignCash((prev)=>prev+usd);setMessage(`${won(value)} → $${usd.toFixed(2)} 모의 환전 완료`);addLog("환전",`KRW ${won(value)} → USD $${usd.toFixed(2)}`);}
  function exchangeToKrw(){const usd=num();if(!Number.isFinite(usd)||usd<=0||usd>foreignCash){setMessage("환전할 USD 금액을 확인해 주세요.");return;}const krw=usd*usdKrw;setForeignCash((prev)=>prev-usd);setCash((prev)=>prev+krw);setMessage(`$${usd.toFixed(2)} → ${won(krw)} 모의 환전 완료`);addLog("환전",`USD $${usd.toFixed(2)} → KRW ${won(krw)}`);}

  return (
    <section className="service-page banking-page">
      <div className="service-hero"><div><span className="service-kicker">BANKING · SERVICE</span><h1>이체와 계좌업무를 한곳에서</h1><p>모의 예수금을 이용해 입금, 이체, 환전, 계좌관리 업무를 체험할 수 있습니다.</p></div><div className="bank-balance"><span>원화 주문가능</span><strong>{won(cash)}</strong><em>USD ${foreignCash.toLocaleString(undefined,{maximumFractionDigits:2})}</em></div></div>

      <div className="bank-quick-grid"><button onClick={()=>setMode("transfer")} className={mode==="transfer"?"active":""}><i>↗</i><span><strong>이체</strong><em>다른 계좌로 보내기</em></span></button><button onClick={()=>setMode("deposit")} className={mode==="deposit"?"active":""}><i>＋</i><span><strong>입금</strong><em>모의 예수금 충전</em></span></button><button onClick={()=>setMode("exchange")} className={mode==="exchange"?"active":""}><i>＄</i><span><strong>환전</strong><em>KRW ↔ USD</em></span></button><button onClick={()=>setMode("account")} className={mode==="account"?"active":""}><i>▣</i><span><strong>계좌관리</strong><em>정보·증명서·설정</em></span></button></div>

      <div className="service-two-col banking-main-grid">
        <article className="service-card banking-work-card">
          {mode === "transfer" && <><div className="service-card-head"><div><span>빠른이체</span><strong>모의 계좌이체</strong></div><em>수수료 0원</em></div><div className="bank-form"><label><span>출금계좌</span><div className="fake-input">POSCO-000001 <b>{won(cash)}</b></div></label><label><span>받는계좌</span><input value={recipient} onChange={(e)=>setRecipient(e.target.value)}/></label><label><span>이체금액</span><div className="amount-input"><input type="number" value={amount} onChange={(e)=>setAmount(e.target.value)}/><b>원</b></div></label><div className="amount-presets">{[100000,500000,1000000].map((v)=><button key={v} onClick={()=>setAmount(String(v))}>+{(v/10000).toLocaleString()}만원</button>)}</div><button className="primary-action wide" onClick={transfer}>모의 이체하기</button></div></>}
          {mode === "deposit" && <><div className="service-card-head"><div><span>입금</span><strong>모의 예수금 충전</strong></div><em>학습용</em></div><div className="bank-form"><label><span>입금할 금액</span><div className="amount-input"><input type="number" value={amount} onChange={(e)=>setAmount(e.target.value)}/><b>원</b></div></label><p className="bank-help">실제 은행계좌와 연결되지 않습니다. 프로젝트 기능 테스트를 위한 가상 입금입니다.</p><button className="primary-action wide" onClick={deposit}>모의 입금하기</button></div></>}
          {mode === "exchange" && <><div className="service-card-head"><div><span>외화</span><strong>원화 ↔ 달러 환전</strong></div><em>$1 = {usdKrw.toLocaleString()}원</em></div><div className="exchange-balance"><div><span>KRW</span><strong>{won(cash)}</strong></div><div><span>USD</span><strong>${foreignCash.toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div></div><div className="bank-form"><label><span>환전금액</span><div className="amount-input"><input type="number" min="0" value={amount} onChange={(e)=>setAmount(e.target.value)}/><b>KRW / USD</b></div></label><div className="exchange-actions"><button className="primary-action" onClick={exchangeToUsd}>원화 → USD</button><button className="outline-action" onClick={exchangeToKrw}>USD → 원화</button></div><p className="bank-help">원화 → USD는 입력값을 원화로, USD → 원화는 달러로 계산합니다.</p></div></>}
          {mode === "account" && <><div className="service-card-head"><div><span>계좌관리</span><strong>계좌 · 인증 · 증명서</strong></div></div><div className="account-service-grid"><button><i>01</i><span><strong>계좌정보</strong><em>계좌명·거래설정 확인</em></span></button><button><i>02</i><span><strong>출금계좌 관리</strong><em>약정계좌 등록·변경</em></span></button><button><i>03</i><span><strong>거래내역서</strong><em>기간별 내역 조회</em></span></button><button><i>04</i><span><strong>잔고증명서</strong><em>모의 증명서 메뉴</em></span></button><button><i>05</i><span><strong>OTP · 인증</strong><em>보안설정 안내</em></span></button><button><i>06</i><span><strong>개인정보</strong><em>연락처·알림 설정</em></span></button></div></>}
          <div className="bank-message"><b>처리 결과</b><span>{message}</span></div>
        </article>

        <article className="service-card banking-history-card"><div className="service-card-head"><div><span>최근 업무</span><strong>입출금 · 이체 · 환전 내역</strong></div><button className="text-action" onClick={()=>setLogs([])}>내역 지우기</button></div>{logs.length===0?<div className="bank-empty"><span>↕</span><strong>최근 처리한 업무가 없습니다.</strong><em>왼쪽에서 모의 이체나 환전을 실행해 보세요.</em></div>:<div className="bank-log-list">{logs.map((log)=><div key={log.id}><span className="bank-log-type">{log.type}</span><span><strong>{log.text}</strong><em>{log.time}</em></span></div>)}</div>}</article>
      </div>

      <div className="service-card banking-shortcuts"><div className="service-card-head"><div><span>업무 바로가기</span><strong>자주 찾는 증권 업무</strong></div></div><div className="shortcut-row"><button>청약 · 권리</button><button>대체입출고</button><button>공모주 청약</button><button>배당금 조회</button><button>세금 · 수수료</button><button>거래확인서</button><button>고객정보 변경</button><button>알림 설정</button></div></div>
    </section>
  );
}
