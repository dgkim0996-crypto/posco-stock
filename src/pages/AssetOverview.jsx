import React, { useMemo, useState } from "react";

function won(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.round(value)).toLocaleString()}원`;
}

function pct(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function AssetOverview({
  cash,
  foreignCash,
  usdKrw,
  spotPositions,
  futuresPositions,
  allAssets,
  spotValue,
  spotCost,
  futuresPnl,
  marginTotal,
  totalAssets,
  totalPnl,
  totalReturn,
  spotPriceInKRW,
  assetPrice,
  onGoTrading,
}) {
  const [subTab, setSubTab] = useState("overview");

  const holdingRows = useMemo(() => Object.entries(spotPositions).map(([id, pos]) => {
    const asset = allAssets.find((item) => item.id === id);
    const current = asset ? spotPriceInKRW(asset) : 0;
    const value = current * pos.quantity;
    const pnl = (current - pos.avgPrice) * pos.quantity;
    const rate = pos.avgPrice > 0 ? ((current - pos.avgPrice) / pos.avgPrice) * 100 : 0;
    return { id, pos, asset, current, value, pnl, rate };
  }), [spotPositions, allAssets, spotPriceInKRW]);

  const stockValue = holdingRows.filter((row) => row.pos.type === "stocks").reduce((sum, row) => sum + row.value, 0);
  const bondValue = holdingRows.filter((row) => row.pos.type === "bonds").reduce((sum, row) => sum + row.value, 0);
  const cryptoValue = holdingRows.filter((row) => row.pos.type === "crypto").reduce((sum, row) => sum + row.value, 0);
  const base = Math.max(totalAssets, 1);
  const foreignCashValue = foreignCash * usdKrw;
  const investedPercent = Math.max(0, Math.min(100, ((spotValue + marginTotal) / base) * 100));
  const allocation = [
    { label: "현금", value: cash, cls: "alloc-cash" },
    { label: "외화", value: foreignCashValue, cls: "alloc-foreign" },
    { label: "주식", value: stockValue, cls: "alloc-stock" },
    { label: "채권", value: bondValue, cls: "alloc-bond" },
    { label: "디지털자산", value: cryptoValue, cls: "alloc-crypto" },
    { label: "선물 증거금", value: marginTotal, cls: "alloc-futures" },
  ].filter((item) => item.value > 0);

  return (
    <section className="service-page asset-page">
      <div className="service-hero">
        <div>
          <span className="service-kicker">MY 자산</span>
          <h1>내 자산을 한눈에</h1>
          <p>원화·외화자산, 상품별 잔고, 평가손익을 모의계좌 기준으로 확인합니다.</p>
        </div>
        <button type="button" className="primary-action" onClick={() => onGoTrading("stocks")}>주식 거래하기</button>
      </div>

      <div className="subnav-tabs">
        {[["overview","한눈에보기"],["holdings","상품별 잔고"],["profit","손익분석"],["account","계좌정보"]].map(([key,label]) => (
          <button key={key} type="button" className={subTab === key ? "active" : ""} onClick={() => setSubTab(key)}>{label}</button>
        ))}
      </div>

      {subTab === "overview" && (
        <>
          <div className="asset-highlight-grid">
            <article className="asset-total-card">
              <span>총 평가자산</span>
              <strong>{won(totalAssets)}</strong>
              <div className="asset-delta">
                <b className={totalPnl >= 0 ? "up" : "down"}>{won(totalPnl)}</b>
                <em className={totalPnl >= 0 ? "up" : "down"}>{pct(totalReturn)}</em>
              </div>
              <small>모의투자 시작금 10,000,000원 대비</small>
            </article>
            <article className="asset-summary-card"><span>주문가능금액</span><strong>{won(cash)}</strong><small>즉시 주문에 사용할 수 있는 원화</small></article>
            <article className="asset-summary-card"><span>외화 보유</span><strong>${foreignCash.toLocaleString(undefined,{maximumFractionDigits:2})}</strong><small>모의 환전으로 보유 중인 USD</small></article>
            <article className="asset-summary-card"><span>투자상품 평가액</span><strong>{won(spotValue + marginTotal)}</strong><small>현물 평가액 + 선물 증거금</small></article>
          </div>

          <div className="service-two-col asset-overview-grid">
            <article className="service-card allocation-card">
              <div className="service-card-head"><div><span>자산배분</span><strong>상품별 비중</strong></div><em>{allocation.length}개 자산군</em></div>
              <div className="allocation-body">
                <div className="allocation-donut" style={{ background: `conic-gradient(#0f8fd0 0 ${investedPercent}%, #d1dce6 ${investedPercent}% 100%)` }}>
                  <div><strong>{Math.round(investedPercent)}%</strong><span>투자중</span></div>
                </div>
                <div className="allocation-list">
                  {allocation.map((item) => (
                    <div key={item.label}><span><i className={item.cls} />{item.label}</span><strong>{won(item.value)}</strong><em>{((item.value/base)*100).toFixed(1)}%</em></div>
                  ))}
                </div>
              </div>
            </article>

            <article className="service-card">
              <div className="service-card-head"><div><span>오늘의 손익</span><strong>평가손익 요약</strong></div><em>실시간 모의시세</em></div>
              <div className="profit-breakdown">
                <div><span>현물 평가손익</span><strong className={spotValue - spotCost >= 0 ? "up" : "down"}>{won(spotValue - spotCost)}</strong></div>
                <div><span>선물 평가손익</span><strong className={futuresPnl >= 0 ? "up" : "down"}>{won(futuresPnl)}</strong></div>
                <div><span>총 평가손익</span><strong className={totalPnl >= 0 ? "up" : "down"}>{won(totalPnl)}</strong></div>
              </div>
              <div className="mini-bar-group">
                <div><span>현물 투자비중</span><i><b style={{width:`${Math.min(100,(spotValue/base)*100)}%`}} /></i><em>{((spotValue/base)*100).toFixed(1)}%</em></div>
                <div><span>현금 비중</span><i><b style={{width:`${Math.min(100,(cash/base)*100)}%`}} /></i><em>{((cash/base)*100).toFixed(1)}%</em></div>
                <div><span>파생 증거금</span><i><b style={{width:`${Math.min(100,(marginTotal/base)*100)}%`}} /></i><em>{((marginTotal/base)*100).toFixed(1)}%</em></div>
              </div>
            </article>
          </div>

          <article className="service-card">
            <div className="service-card-head"><div><span>보유자산</span><strong>상위 보유상품</strong></div><button type="button" className="text-action" onClick={() => setSubTab("holdings")}>전체보기 →</button></div>
            <div className="service-table-wrap"><table className="service-table"><thead><tr><th>종목명</th><th>보유수량</th><th>현재가</th><th>평가금액</th><th>평가손익</th><th>수익률</th></tr></thead><tbody>
              {holdingRows.length === 0 ? <tr><td colSpan="6" className="empty">보유 중인 상품이 없습니다.</td></tr> : holdingRows.slice(0,6).map((row) => <tr key={row.id}><td><strong>{row.asset?.name}</strong><span>{row.asset?.symbol}</span></td><td>{row.pos.quantity.toLocaleString(undefined,{maximumFractionDigits:6})}</td><td>{row.asset ? assetPrice(row.asset) : "-"}</td><td>{won(row.value)}</td><td className={row.pnl >= 0 ? "up" : "down"}>{won(row.pnl)}</td><td className={row.rate >= 0 ? "up" : "down"}>{pct(row.rate)}</td></tr>)}
            </tbody></table></div>
          </article>
        </>
      )}

      {subTab === "holdings" && (
        <article className="service-card">
          <div className="service-card-head"><div><span>상품별 잔고</span><strong>전체 보유상품</strong></div><em>{holdingRows.length}종목</em></div>
          <div className="service-table-wrap"><table className="service-table"><thead><tr><th>종목명</th><th>구분</th><th>보유수량</th><th>평균단가</th><th>현재가</th><th>평가금액</th><th>평가손익</th><th>수익률</th></tr></thead><tbody>
            {holdingRows.length === 0 ? <tr><td colSpan="8" className="empty">거래 후 보유상품이 이곳에 표시됩니다.</td></tr> : holdingRows.map((row) => <tr key={row.id}><td><strong>{row.asset?.name}</strong><span>{row.asset?.symbol}</span></td><td>{row.pos.type === "stocks" ? "주식" : row.pos.type === "bonds" ? "채권" : "디지털"}</td><td>{row.pos.quantity.toLocaleString(undefined,{maximumFractionDigits:6})}</td><td>{won(row.pos.avgPrice)}</td><td>{row.asset ? assetPrice(row.asset) : "-"}</td><td>{won(row.value)}</td><td className={row.pnl >= 0 ? "up" : "down"}>{won(row.pnl)}</td><td className={row.rate >= 0 ? "up" : "down"}>{pct(row.rate)}</td></tr>)}
          </tbody></table></div>
        </article>
      )}

      {subTab === "profit" && (
        <div className="service-two-col">
          <article className="service-card"><div className="service-card-head"><div><span>손익분석</span><strong>자산군별 평가손익</strong></div></div><div className="profit-list"><div><span>주식·채권·디지털자산</span><strong className={spotValue-spotCost >= 0 ? "up":"down"}>{won(spotValue-spotCost)}</strong></div><div><span>선물옵션</span><strong className={futuresPnl >= 0 ? "up":"down"}>{won(futuresPnl)}</strong></div><div className="total"><span>합계</span><strong className={totalPnl >= 0 ? "up":"down"}>{won(totalPnl)}</strong></div></div></article>
          <article className="service-card"><div className="service-card-head"><div><span>투자현황</span><strong>매입원금과 평가액</strong></div></div><div className="comparison-block"><div><span>현물 매입원금</span><strong>{won(spotCost)}</strong></div><div><span>현물 평가금액</span><strong>{won(spotValue)}</strong></div><div><span>선물 증거금</span><strong>{won(marginTotal)}</strong></div><div><span>총 수익률</span><strong className={totalReturn >= 0 ? "up":"down"}>{pct(totalReturn)}</strong></div></div></article>
        </div>
      )}

      {subTab === "account" && (
        <div className="service-two-col">
          <article className="service-card account-detail-card"><div className="service-card-head"><div><span>계좌상세</span><strong>모의종합계좌</strong></div><em>정상</em></div><dl><div><dt>계좌번호</dt><dd>POSCO-000001</dd></div><div><dt>계좌유형</dt><dd>종합매매 · 모의투자</dd></div><div><dt>원화 예수금</dt><dd>{won(cash)}</dd></div><div><dt>외화 예수금</dt><dd>USD {foreignCash.toLocaleString(undefined,{maximumFractionDigits:2})}</dd></div><div><dt>미수금</dt><dd>0원</dd></div><div><dt>대출잔액</dt><dd>0원</dd></div></dl></article>
          <article className="service-card"><div className="service-card-head"><div><span>계좌업무</span><strong>빠른 메뉴</strong></div></div><div className="quick-menu-grid"><button type="button">거래내역 조회</button><button type="button">수수료 조회</button><button type="button">권리·청약 현황</button><button type="button">증거금 현황</button><button type="button">계좌별 잔고</button><button type="button">결제 예정금액</button></div></article>
        </div>
      )}
    </section>
  );
}
