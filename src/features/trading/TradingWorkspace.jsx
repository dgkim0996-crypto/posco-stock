import MarketList from "../../components/MarketList.jsx";
import InstrumentSummary from "../market/InstrumentSummary.jsx";
import TradingChartPanel from "../chart/TradingChartPanel.jsx";
import OrderPanel from "./OrderPanel.jsx";
import OrderWorkspace from "../../components/OrderWorkspace.jsx";
import { money } from "../../utils/tradingFormatters.js";
import { isStockCategory } from "../market/marketHelpers.js";
import StockFundamentals from "../../components/StockFundamentals.jsx";
import React from "react";

export default function TradingWorkspace({
  assets, selected, setSelectedId, marketCategory, favorites, toggleFavorite, category, bestAsk, bestBid,
  chartPeriod, setChartPeriod, chartIndicators, setChartIndicators, chartLoading, chartData, chartError,
  selectedAveragePrice, selectedTradeMarkers, orderTab, setOrderTab, pendingOrders, filledOrders,
  orderSide, setOrderSide, orderBook, setOrderType, setLimitPrice, orderType, limitPrice, quantity,
  setQuantity, setMaximumOrderQuantity, orderAvailability, selectedOwnedQuantity, financeAccount,
  lendingUsed, orderTaxPreview, accountReady, accountLoading, orderBusy, busyOrderId, reviewOrder,
  message, allAssets, reviewPendingOrder, accountOrders, markets, goTrading, refreshAccount, accountError,
  cash, spotValue, marginTotal, futuresPnl, totalPnl, totalAssets,
}) {
  return (
    <main className="workspace">
      <aside className="panel left-panel">
        <div className="panel-title">
          <div><span>종목</span><strong>관심·시세</strong></div>
          <em>{assets.length}종목</em>
        </div>
        <MarketList
          assets={assets}
          selectedId={selected.id}
          onSelect={setSelectedId}
          type={marketCategory}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
        />
      </aside>

      <section className="center">
        <InstrumentSummary {...{
        selected, category, bestAsk, bestBid,
      }} />

        <div className="trading-grid">
          <TradingChartPanel {...{
        chartPeriod, setChartPeriod, chartIndicators, setChartIndicators, chartLoading, chartData,
        selected, chartError, selectedAveragePrice, selectedTradeMarkers,
      }} />

          <OrderPanel {...{
        orderTab, setOrderTab, pendingOrders, filledOrders, selected, orderSide, setOrderSide, category,
        orderBook, setOrderType, setLimitPrice, orderType, limitPrice, quantity, setQuantity,
        setMaximumOrderQuantity, orderAvailability, selectedOwnedQuantity, financeAccount, lendingUsed,
        orderTaxPreview, accountReady, accountLoading, orderBusy, busyOrderId, reviewOrder, message,
        allAssets, reviewPendingOrder,
      }} />
        </div>

      </section>

      <div className="home-wide-panel"><OrderWorkspace orders={accountOrders} pendingOrders={pendingOrders} assets={allAssets} selectedSymbol={selected.symbol} onSelectAsset={(id) => { const entry = Object.entries(markets).find(([, list]) => list.some((item) => item.id === id)); if (entry) goTrading(entry[0], id); }} onAmend={(order) => reviewPendingOrder("amend", order)} onCancel={(order) => reviewPendingOrder("cancel", order)} onRefresh={() => refreshAccount()} loading={accountLoading || orderBusy} error={accountError} busyOrderId={busyOrderId} /></div>

      <div className="panel account-panel home-wide-panel">
        <div className="panel-title">
          <div><span>계좌</span><strong>자산현황</strong></div>
          <em>모의투자</em>
        </div>
        <div className="summary">
          <div><span>예수금</span><strong>{money(cash)}</strong></div>
          <div><span>주식·채권 평가액</span><strong>{money(spotValue)}</strong></div>
          <div><span>선물 증거금</span><strong>{money(marginTotal)}</strong></div>
          <div><span>선물 평가손익</span><strong className={futuresPnl >= 0 ? "up" : "down"}>{money(futuresPnl)}</strong></div>
          <div><span>총 평가손익</span><strong className={totalPnl >= 0 ? "up" : "down"}>{money(totalPnl)}</strong></div>
          <div><span>총 평가자산</span><strong>{money(totalAssets)}</strong></div>
        </div>
      </div>
      {isStockCategory(category) && (selected.synthetic
        ? <section className="panel synthetic-product-info home-wide-panel"><strong>10배 레버리지 모의 ETF</strong><p>삼성전자와 SK하이닉스의 당일 등락률을 동일 비중으로 합산한 뒤 10배로 추종합니다. 일간 재조정 상품이므로 장기 누적수익은 기초종목 누적수익의 정확한 10배가 아니며, 급락 시 원금 대부분을 잃을 수 있습니다.</p><div><span>기초자산 <b>삼성전자 50% · SK하이닉스 50%</b></span><span>기준가 <b>10,000원</b></span><span>레버리지 <b>일간 10배</b></span></div></section>
        : <div className="home-wide-panel"><StockFundamentals asset={selected} /></div>)}
    </main>
  );
}
