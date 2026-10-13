import { useTradingModel } from "./useTradingModel.js";
import OrderToasts from "../features/trading/OrderToasts.jsx";
import TradingHeader from "../features/navigation/TradingHeader.jsx";
import { money, signedPercent } from "../utils/tradingFormatters.js";
import { LABELS } from "../features/market/marketConstants.js";
import TradingWorkspace from "../features/trading/TradingWorkspace.jsx";
import InvestmentDashboard from "../features/dashboard/InvestmentDashboard.jsx";
import SecondaryPages from "./SecondaryPages.jsx";
import WelcomeGuide from "../features/preferences/WelcomeGuide.jsx";
import OrderDialog from "../components/OrderDialog.jsx";
import React from "react";

export default function TradingApp({ session, onSignOut }) {
  const {
    orderToasts, dismissOrderToast, setMainTab, mainTab, headerSearchOpen, setHeaderSearchOpen,
    headerSearchResults, openSearchResult, headerSearchQuery, setHeaderSearchQuery, accountNumber,
    setTheme, theme, realtimeStatus, marketDataStatus, selected, riskStatus, totalAssets, cash, totalPnl,
    totalReturn, reset, domesticSession, orderAvailability, refreshAccount, accountLoading, orderBusy,
    busyOrderId, accountError, matchingStatus, category, setCategory, assets, setSelectedId,
    marketCategory, favorites, toggleFavorite, bestAsk, bestBid, chartPeriod, setChartPeriod,
    chartIndicators, setChartIndicators, chartLoading, chartData, chartError, selectedAveragePrice,
    selectedTradeMarkers, orderTab, setOrderTab, pendingOrders, filledOrders, orderSide, setOrderSide,
    orderBook, setOrderType, setLimitPrice, orderType, limitPrice, quantity, setQuantity,
    setMaximumOrderQuantity, selectedOwnedQuantity, financeAccount, lendingUsed, orderTaxPreview,
    accountReady, reviewOrder, message, allAssets, reviewPendingOrder, accountOrders, markets, goTrading,
    spotValue, marginTotal, futuresPnl, spotPositions, shortPositions, futuresPositions, closeFuture,
    trades, editDashboard, resetDashboardLayout, setEditDashboard, dashboardWidgets,
    updateDashboardWidget, dragOverWidget, resizingWidget, setDragOverWidget, draggingWidget,
    moveDashboardWidget, setDraggingWidget, startDashboardResize, foreignCash, spotCost, financeDebt,
    lendingCollateral, orderEvents, ledgerEntries, settlements, marketIndices, openStockFromInfo, setCash,
    setForeignCash, setFinanceAccount, showWelcomeGuide, dismissWelcomeGuide, startFirstTrade,
    orderDialog, setOrderDialog, submitReviewedOrder,
  } = useTradingModel(session);
  return (
    <div className="terminal">
      <OrderToasts {...{
          orderToasts, dismissOrderToast,
        }} />
      <TradingHeader {...{
          setMainTab, mainTab, headerSearchOpen, setHeaderSearchOpen, headerSearchResults,
          openSearchResult, headerSearchQuery, setHeaderSearchQuery, accountNumber, onSignOut, session,
          setTheme, theme,
        }} />

      {mainTab === "trading" && (
        <>
      <section className="account-strip">
        <div className="market-status">
          <span className="status-dot" />
          <strong>{realtimeStatus.connected ? "KIS 실시간 연결" : marketDataStatus.connected ? "KIS REST 연결" : "시세 연결 중"}</strong>
          <span>{realtimeStatus.connected
            ? `${selected.name} 체결가·호가 WebSocket 수신`
            : marketDataStatus.connected ? `전체 ${marketDataStatus.cachedSymbols}종목 REST 폴백` : "마지막 정상 가격 유지"}</span>
        </div>
        {riskStatus && riskStatus.status!=="SAFE" && <div className={`risk-alert ${riskStatus.status.toLowerCase()}`}><strong>{riskStatus.status==="WARNING"?"증거금 주의":riskStatus.status==="MARGIN_CALL"?"마진콜 발생":"강제청산 위험"}</strong><span>위험비율 {riskStatus.requiredMargin>0?`${((riskStatus.equity/riskStatus.requiredMargin)*100).toFixed(1)}%`:"-"} · 부족액 {money(riskStatus.deficit)}</span></div>}
        <div className="top-metrics">
          {/* 홈 계좌 핵심 수치는 한 그룹으로 유지하고 초기화 동작은 별도 버튼으로 분리한다. */}
          <div className="top-metric-cards">
            <div><span>총 평가자산</span><strong>{money(totalAssets)}</strong></div>
            <div><span>주문가능금액</span><strong>{money(cash)}</strong></div>
            <div>
              <span>평가손익</span>
              <strong className={totalPnl >= 0 ? "up" : "down"}>{money(totalPnl)}</strong>
            </div>
            <div>
              <span>수익률</span>
              <strong className={totalPnl >= 0 ? "up" : "down"}>{signedPercent(totalReturn)}</strong>
            </div>
          </div>
          <button className="reset" onClick={reset}>계좌 초기화</button>
        </div>
      </section>

      <div className="broker-session-strip">
        <span className={domesticSession.isRegularSession ? "session-open" : ""} title={domesticSession.description}>KRX · {domesticSession.label}</span>
        <span>모의거래 · 지정가 주문은 취소 전까지 유지</span>
        <span>매수 예약금 <b>{money(orderAvailability.reservedCash)}</b></span>
        <button type="button" onClick={() => refreshAccount()} disabled={accountLoading || orderBusy || Boolean(busyOrderId)}>{accountLoading ? "계좌 조회 중…" : "계좌 새로고침 ↻"}</button>
      </div>
      {accountError && <div className="broker-account-error" role="alert">계좌를 확인하지 못해 주문이 잠시 중단되었습니다. {accountError} <button type="button" onClick={() => refreshAccount()}>다시 조회</button></div>}
      {matchingStatus?.status === "degraded" && <div className="broker-account-error" role="status">지정가 자동체결을 확인하지 못했습니다. 주문은 미체결로 보존됩니다. 운영 상태와 서버 연결을 확인해 주세요.</div>}

      <div className="tabs">
        {Object.entries(LABELS).map(([key, label]) => (
          <button
            key={key}
            className={category === key ? "active" : ""}
            onClick={() => setCategory(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <TradingWorkspace {...{
          assets, selected, setSelectedId, marketCategory, favorites, toggleFavorite, category, bestAsk,
          bestBid, chartPeriod, setChartPeriod, chartIndicators, setChartIndicators, chartLoading,
          chartData, chartError, selectedAveragePrice, selectedTradeMarkers, orderTab, setOrderTab,
          pendingOrders, filledOrders, orderSide, setOrderSide, orderBook, setOrderType, setLimitPrice,
          orderType, limitPrice, quantity, setQuantity, setMaximumOrderQuantity, orderAvailability,
          selectedOwnedQuantity, financeAccount, lendingUsed, orderTaxPreview, accountReady,
          accountLoading, orderBusy, busyOrderId, reviewOrder, message, allAssets, reviewPendingOrder,
          accountOrders, markets, goTrading, refreshAccount, accountError, cash, spotValue, marginTotal,
          futuresPnl, totalPnl, totalAssets,
        }} />

      <InvestmentDashboard {...{
          spotPositions, shortPositions, allAssets, futuresPositions, markets, closeFuture, trades,
          editDashboard, resetDashboardLayout, setEditDashboard, dashboardWidgets, updateDashboardWidget,
          dragOverWidget, resizingWidget, setDragOverWidget, draggingWidget, moveDashboardWidget,
          setDraggingWidget, startDashboardResize,
        }} />
        </>
      )}

      <SecondaryPages {...{
          mainTab, cash, foreignCash, spotPositions, futuresPositions, allAssets, spotValue, spotCost,
          futuresPnl, marginTotal, totalAssets, totalPnl, totalReturn, financeDebt, lendingCollateral,
          lendingUsed, orderEvents, ledgerEntries, settlements, goTrading, markets, marketIndices,
          openStockFromInfo, setCash, setForeignCash, financeAccount, setFinanceAccount,
        }} />

      <footer>
        <strong>포스코증권 모의투자</strong>
        <span>본 화면은 학습용 모의투자 서비스이며 실제 주문을 전송하지 않습니다. 외부 제공 시세와 모의 상품 가격을 사용하며, 주문·체결·환율·비용에는 모의 정책이 적용됩니다.</span>
      </footer>

      {showWelcomeGuide && (
        <WelcomeGuide {...{
          dismissWelcomeGuide, session, startFirstTrade,
        }} />
      )}
      {orderDialog && <OrderDialog key={`${orderDialog.action}:${orderDialog.order?.id || "new"}`} draft={orderDialog} busy={orderBusy} onClose={() => setOrderDialog(null)} onSubmit={submitReviewedOrder} />}
    </div>
  );
}
