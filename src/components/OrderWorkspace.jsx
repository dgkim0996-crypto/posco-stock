import React, { useId, useMemo, useState } from "react";
import { buildOrderRows, filterOrderRows, formatOrderDateTime, isOrderDateKey, kstDateKey, orderMatchesStatus, orderRowsToCsv, orderStatus, summarizeOrderRows } from "../utils/orderWorkspace.js";
import "./OrderWorkspace.css";

const STATUS_FILTERS = [["all", "전체"], ["pending", "미체결"], ["filled", "체결"], ["cancelled", "취소"]];
const numberText = (value, digits = 8) => value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toLocaleString("ko-KR", { maximumFractionDigits: digits });
const moneyText = (value, currency = "KRW") => value == null ? "—" : `${currency === "USD" ? "$" : ""}${numberText(value, currency === "USD" ? 4 : 2)}${currency === "USD" ? "" : "원"}`;

export default function OrderWorkspace({ orders = [], pendingOrders = [], assets = [], selectedSymbol, onSelectAsset, onAmend, onCancel, onRefresh, loading = false, error = "", busyOrderId = null }) {
  const id = useId();
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const [side, setSide] = useState("all");
  const [period, setPeriod] = useState("all");
  const [startDate, setStartDate] = useState(() => kstDateKey(Date.now() - 6 * 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState(() => kstDateKey());
  const [selectedOnly, setSelectedOnly] = useState(false);
  const rows = useMemo(() => buildOrderRows(orders, pendingOrders, assets), [orders, pendingOrders, assets]);
  const today = kstDateKey();
  const dateError = period !== "custom" ? "" : !isOrderDateKey(startDate) || !isOrderDateKey(endDate) ? "조회 시작일과 종료일을 모두 입력해 주세요." : startDate > endDate ? "종료일은 시작일과 같거나 이후여야 합니다." : "";
  const scopedRows = useMemo(() => filterOrderRows(rows, { keyword, side, period, startDate, endDate, selectedOnly, selectedSymbol }), [rows, keyword, side, period, startDate, endDate, selectedOnly, selectedSymbol, today]);
  const counts = useMemo(() => summarizeOrderRows(scopedRows), [scopedRows]);
  const visibleRows = useMemo(() => scopedRows.filter((row) => orderMatchesStatus(row, status)), [scopedRows, status]);
  const summary = useMemo(() => summarizeOrderRows(visibleRows), [visibleRows]);
  const hasFilters = keyword || side !== "all" || period !== "all" || selectedOnly || status !== "all";
  const selectedName = assets.find((asset) => asset.symbol === selectedSymbol)?.name || selectedSymbol;

  const resetFilters = () => { setKeyword(""); setSide("all"); setPeriod("all"); setSelectedOnly(false); setStatus("all"); };
  const downloadCsv = () => {
    const url = URL.createObjectURL(new Blob([orderRowsToCsv(visibleRows)], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `주문체결내역_${kstDateKey()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className="panel order-workspace" aria-labelledby={`${id}-title`} aria-busy={loading}>
    <div className="ow-heading">
      <div><span className="ow-eyebrow">ACCOUNT ORDERS</span><h2 id={`${id}-title`}>주문 · 체결 내역</h2><p>계좌의 주문 상태와 체결 수량을 한눈에 확인하세요.</p></div>
      <div className="ow-heading-actions">
        <button type="button" onClick={downloadCsv} disabled={!visibleRows.length || loading}>CSV 다운로드</button>
        <button type="button" onClick={onRefresh} disabled={loading || !onRefresh} aria-label="주문·체결 내역 새로고침">{loading ? "조회 중…" : "새로고침"}</button>
      </div>
    </div>

    <div className="ow-filters">
      <label className="ow-search"><span className="ow-sr-only">종목명, 종목코드 또는 주문번호 검색</span><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.5 12.5 4 4"/></svg><input type="search" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="종목명 · 코드 · 주문번호"/></label>
      <label className="ow-select"><span>매매</span><select value={side} onChange={(event) => setSide(event.target.value)}><option value="all">전체</option><option value="BUY">매수</option><option value="SELL">매도</option></select></label>
      <label className="ow-select"><span>주문일</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="all">전체 기간</option><option value="today">오늘</option><option value="7days">최근 7일</option><option value="30days">최근 30일</option><option value="custom">기간 직접 지정</option></select></label>
      <label className="ow-selected"><input type="checkbox" checked={selectedOnly} onChange={(event) => setSelectedOnly(event.target.checked)} disabled={!selectedSymbol}/><span>선택 종목만{selectedOnly && selectedName && <small>{selectedName}</small>}</span></label>
      {hasFilters && <button type="button" className="ow-reset" onClick={resetFilters}>초기화</button>}
      {period === "custom" && <div className="ow-date-range"><label><span>시작일</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? `${id}-date-error` : undefined}/></label><span aria-hidden="true">~</span><label><span>종료일</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} aria-invalid={Boolean(dateError)} aria-describedby={dateError ? `${id}-date-error` : undefined}/></label><small>한국 표준시(KST) 기준 · 양 끝 날짜 포함</small>{dateError && <p id={`${id}-date-error`} className="ow-date-error" role="alert">{dateError}</p>}</div>}
    </div>

    <div className="ow-status-bar"><div className="ow-status-filters" role="group" aria-label="주문 상태 필터">{STATUS_FILTERS.map(([value, label]) => <button type="button" key={value} className={status === value ? "is-active" : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}<b>{counts[value]}</b></button>)}</div><span className="ow-count" role="status" aria-live="polite">{loading ? "주문 조회 중" : `${visibleRows.length}건 조회`}</span></div>

    {error && <div className="ow-error" role="alert"><strong>주문 내역을 새로 불러오지 못했습니다.</strong><span>{typeof error === "string" ? error : error.message || "잠시 후 다시 시도해 주세요."}</span></div>}

    <div className="ow-summary" aria-label="조회 결과의 체결 금액 합계"><div><span>매수 체결금액</span><strong className="ow-buy">{moneyText(summary.buyAmount)}</strong></div><div><span>매도 체결금액</span><strong className="ow-sell">{moneyText(summary.sellAmount)}</strong></div><div><span>수수료 · 세금 합계</span><strong>{moneyText(summary.costAmount)}</strong></div><p>조회 결과 기준 · 원화<br/>체결금액은 수수료·세금 제외</p></div>

    <div className="ow-table-scroll" role="region" aria-label="주문·체결 내역 표, 가로로 스크롤 가능" tabIndex={0}>
      <table className="ow-table">
        <caption className="ow-sr-only">주문·체결 내역. 시간은 한국 표준시, 주문일 기준 최신순. 원장 가격은 원화입니다.</caption>
        <thead><tr><th scope="col">주문일시 / 번호</th><th scope="col">종목 / 구분</th><th scope="col">주문 상태</th><th scope="col" className="ow-number">주문 / 체결 수량</th><th scope="col" className="ow-number">미체결 / 취소</th><th scope="col" className="ow-number">주문가 / 평균체결가</th><th scope="col" className="ow-number">수수료 / 세금</th><th scope="col">결제예정일</th><th scope="col">주문 관리</th></tr></thead>
        <tbody>{visibleRows.map((row) => {
          const state = orderStatus(row);
          const time = formatOrderDateTime(row.createdAt);
          const busy = row.pendingOrder?.processing || (busyOrderId != null && [row.id, row.pendingOrder?.id, row.pendingOrder?.pendingOrderId].some((value) => value != null && String(value) === String(busyOrderId)));
          return <tr key={row.key} className={row.symbol === selectedSymbol ? "ow-selected-row" : ""}>
            <td><time dateTime={row.createdAt || undefined} title={time.full}><strong>{time.time}</strong><small>{time.date}</small></time><span className="ow-order-number" title={`주문번호 ${row.id}`}>#{row.id}</span></td>
            <td><button type="button" className="ow-asset" onClick={() => onSelectAsset?.(row.assetId)} disabled={!onSelectAsset} aria-label={`${row.name} 종목 선택`}>{row.name}</button><small>{row.symbol}{row.market ? ` · ${row.market}` : ""}</small><span className={`ow-side ${row.side === "BUY" ? "ow-buy" : "ow-sell"}`}>{row.side === "BUY" ? "매수" : "매도"}</span><span className="ow-order-type">{row.orderType === "MARKET" ? "시장가" : "지정가"}</span></td>
            <td><span className={`ow-badge ow-badge-${state.tone}`}>{state.label}</span>{row.updatedAt && row.updatedAt !== row.createdAt && <small title={`최종 변경 ${formatOrderDateTime(row.updatedAt).full}`}>변경 {formatOrderDateTime(row.updatedAt).time}</small>}{row.incomplete && <small>미체결 잔량 기준</small>}</td>
            <td className="ow-number"><strong>{numberText(row.quantity)}</strong><small className={row.filledQuantity > 0 ? "ow-emphasis" : ""}>체결 {numberText(row.filledQuantity)}</small></td>
            <td className="ow-number"><strong className={row.remainingQuantity > 0 ? "ow-emphasis" : ""}>{numberText(row.remainingQuantity)}</strong><small>취소 {numberText(row.cancelledQuantity)}</small></td>
            <td className="ow-number"><strong>{row.orderType === "MARKET" ? "시장가" : moneyText(row.limitPrice, row.priceCurrency)}</strong><small>체결 {moneyText(row.executionPrice)}</small></td>
            <td className="ow-number"><strong>{moneyText(row.feeAmount)}</strong><small>세금 {moneyText(row.taxAmount)}</small></td>
            <td><span className="ow-settlement">{row.filledQuantity > 0 && row.settlementDate ? String(row.settlementDate).slice(0, 10) : "—"}</span></td>
            <td>{row.pendingOrder ? <div className="ow-row-actions"><button type="button" onClick={() => onAmend?.(row.pendingOrder)} disabled={busy || loading || !onAmend} aria-label={`${row.name} 주문 ${row.id} 정정`}>정정</button><button type="button" onClick={() => onCancel?.(row.pendingOrder)} disabled={busy || loading || !onCancel} aria-label={`${row.name} 주문 ${row.id} 잔량 취소`}>{busy ? "처리 중" : "취소"}</button></div> : <span className="ow-no-action">{row.remainingQuantity > 0 ? "새로고침 필요" : "—"}</span>}</td>
          </tr>;
        })}</tbody>
      </table>
      {visibleRows.length === 0 && <div className="ow-empty"><strong>{loading ? "주문 내역을 조회하고 있습니다…" : dateError ? "조회 기간을 확인해 주세요." : rows.length ? "조건에 맞는 주문이 없습니다." : "아직 주문 내역이 없습니다."}</strong><p>{loading ? "계좌의 최신 상태를 확인합니다." : dateError || (rows.length ? "검색어나 기간, 주문 상태를 변경해 보세요." : "주문을 접수하면 진행 상태와 체결 내역이 여기에 표시됩니다.")}</p>{!loading && hasFilters && <button type="button" onClick={resetFilters}>조회 조건 초기화</button>}</div>}
    </div>
    <p className="ow-footnote">불러온 주문 기준 · 주문일과 시간은 한국 표준시(KST) · 체결 필터에는 부분체결 후 취소한 주문도 포함됩니다. 원장 가격은 원화이며, 원장이 없는 해외 미체결 주문은 달러($)로 표시합니다.</p>
  </section>;
}
