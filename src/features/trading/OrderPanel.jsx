import { assetPrice, money } from "../../utils/tradingFormatters.js";
import { isStockCategory } from "../market/marketHelpers.js";
import { normalizeOrderPrice, stepOrderPrice, getPriceStep, SIMULATED_USD_KRW as USD_KRW } from "../../../shared/tradingRules.js";
import { TRADE_TAX_RULES_AS_OF } from "../../utils/tradeTaxes.js";
import React from "react";

export default function OrderPanel({
  orderTab, setOrderTab, pendingOrders, filledOrders, selected, orderSide, setOrderSide, category,
  orderBook, setOrderType, setLimitPrice, orderType, limitPrice, quantity, setQuantity,
  setMaximumOrderQuantity, orderAvailability, selectedOwnedQuantity, financeAccount, lendingUsed,
  orderTaxPreview, accountReady, accountLoading, orderBusy, busyOrderId, reviewOrder, message, allAssets,
  reviewPendingOrder,
}) {
  return (
    <div className="panel order-panel">
      <div className="order-tabs">
        <button className={orderTab === "order" ? "active" : ""} type="button" onClick={() => setOrderTab("order")}>주문</button>
        <button className={orderTab === "pending" ? "active" : ""} type="button" onClick={() => setOrderTab("pending")}>미체결 <b>{pendingOrders.length}</b></button>
        <button className={orderTab === "filled" ? "active" : ""} type="button" onClick={() => setOrderTab("filled")}>체결 <b>{filledOrders.length}</b></button>
      </div>

      {orderTab === "order" && (
        <>
      <div className="order-heading">
        <span>{selected.name}</span>
        <strong>{assetPrice(selected)}</strong>
      </div>

      <div className="order-side-tabs" role="tablist" aria-label="주문 방향">
        <button
          type="button"
          role="tab"
          aria-selected={orderSide === "BUY"}
          className={`is-buy ${orderSide === "BUY" ? "active" : ""}`}
          onClick={() => setOrderSide("BUY")}
        >
          매수
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={orderSide === "SELL"}
          className={`is-sell ${orderSide === "SELL" ? "active" : ""}`}
          onClick={() => setOrderSide("SELL")}
        >
          매도
        </button>
      </div>

      {isStockCategory(category) && selected.unit === "KRW" && (
        <div className="realtime-orderbook">
          <div className="orderbook-title"><strong>실시간 호가</strong><span>{orderBook ? "10단계 WebSocket" : "REST 기준 추정호가"}</span></div>
          {orderBook ? <>
            {[...orderBook.asks].reverse().map((level, index) => (
              <button type="button" className="orderbook-level ask" key={`ask-${index}`} onClick={() => { setOrderType("LIMIT"); setLimitPrice(String(level.price)); }}>
                <span>{level.quantity?.toLocaleString() ?? "-"}</span><strong>{level.price?.toLocaleString()}</strong><em>매도 {10-index}</em>
              </button>
            ))}
            {[...orderBook.bids].map((level, index) => (
              <button type="button" className="orderbook-level bid" key={`bid-${index}`} onClick={() => { setOrderType("LIMIT"); setLimitPrice(String(level.price)); }}>
                <span>{level.quantity?.toLocaleString() ?? "-"}</span><strong>{level.price?.toLocaleString()}</strong><em>매수 {index+1}</em>
              </button>
            ))}
            <div className="orderbook-total"><span>총 매도 {orderBook.totalAskQuantity?.toLocaleString()}</span><span>총 매수 {orderBook.totalBidQuantity?.toLocaleString()}</span></div>
          </> : <div className="orderbook-waiting">실시간 호가를 연결하고 있습니다. 연결 전에는 상단 추정 최우선 호가를 사용합니다.</div>}
        </div>
      )}

      {category === "bonds" && (
        <div className="info-grid">
          <div><span>수익률</span><strong>{selected.yield.toFixed(2)}%</strong></div>
          <div><span>표면금리</span><strong>{selected.coupon.toFixed(2)}%</strong></div>
          <div><span>만기</span><strong>{selected.maturity}</strong></div>
          <div><span>듀레이션</span><strong>{selected.duration.toFixed(1)}</strong></div>
        </div>
      )}

      {category === "futures" && (
        <div className="info-grid">
          <div><span>승수</span><strong>{selected.currency === "USD"
            ? `$${selected.contractMultiplier.toLocaleString()} × ${USD_KRW.toLocaleString()}원`
            : `${selected.multiplier.toLocaleString()}원`}</strong></div>
          <div><span>증거금률</span><strong>{Math.round(selected.marginRate * 100)}%</strong></div>
          {/* multiplier는 1포인트당 원화 금액이라 해외선물도 원화 증거금으로 표시된다. */}
          <div><span>1계약 증거금</span><strong>{money(selected.price * selected.multiplier * selected.marginRate)}</strong></div>
          <div><span>주문구분</span><strong>신규</strong></div>
        </div>
      )}

      <div className="order-form">
        <div className="order-line">
          <span>주문유형</span>
          <select
            className="order-type-select"
            value={category === "futures" ? "MARKET" : orderType}
            disabled={category === "futures"}
            onChange={(event) => {
              setOrderType(event.target.value);
              if (event.target.value === "LIMIT") setLimitPrice(String(normalizeOrderPrice(selected, selected.price)));
            }}
          >
            <option value="MARKET">시장가</option>
            <option value="LIMIT">지정가</option>
          </select>
        </div>
        <div className="order-line">
          <span>주문가격</span>
          {orderType === "LIMIT" && category !== "futures" ? (
            <div className="broker-price-control"><button type="button" aria-label="주문가격 한 호가 내리기" onClick={() => setLimitPrice(String(stepOrderPrice(selected, Number(limitPrice), "down")))}>−</button><input
              className="limit-price-input"
              aria-label="주문가격"
              type="number"
              min="0"
              step={getPriceStep(selected, Number(limitPrice))}
              value={limitPrice}
              onChange={(event) => setLimitPrice(event.target.value)}
            /><button type="button" aria-label="주문가격 한 호가 올리기" onClick={() => setLimitPrice(String(stepOrderPrice(selected, Number(limitPrice), "up")))}>+</button></div>
          ) : <strong>시장가 <small>({assetPrice(selected)})</small></strong>}
        </div>
        {orderType === "LIMIT" && category !== "futures" && <div className="broker-price-shortcuts"><span>호가단위 {getPriceStep(selected, Number(limitPrice)).toLocaleString("ko-KR", { maximumFractionDigits: 8 })}{selected.unit === "USD" ? "달러" : "원"}</span><button type="button" onClick={() => setLimitPrice(String(normalizeOrderPrice(selected, selected.price)))}>현재가</button></div>}
        <div className="order-line quantity-line">
          <span>{category === "futures" ? "계약수" : "주문수량"}</span>
          <div className="quantity-control">
            <input
              aria-label="주문수량"
              type="number"
              min="0"
              step={category === "crypto" ? "0.00000001" : "1"}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <button type="button" className="quantity-max" onClick={() => setMaximumOrderQuantity()}>최대</button>
          </div>
        </div>
        <div className="broker-quantity-shortcuts" aria-label="주문가능수량 비율">{[.25, .5, .75, 1].map((fraction) => <button type="button" key={fraction} onClick={() => setMaximumOrderQuantity(fraction)}>{fraction * 100}%</button>)}</div>
        <div className="order-line">
          <span>{orderSide === "BUY" || category === "futures" ? "주문가능" : "매도가능 / 보유"}</span>
          <strong>{orderSide === "BUY" || category === "futures"
            ? money(orderAvailability.availableCash)
            : `${orderAvailability.availableSellQuantity.toLocaleString()} / ${selectedOwnedQuantity.toLocaleString()}`}</strong>
        </div>
        {isStockCategory(category) && financeAccount.lending.active && (
          <div className="order-line lending-order-info">
            <span>대주 가능 / 잔고</span>
            <strong>{money(Math.max(0, financeAccount.lending.limit - lendingUsed))} / {money(lendingUsed)}</strong>
          </div>
        )}
        {isStockCategory(category) && selected.unit === "USD" && (
          <div className="order-line">
            <span>적용환율(모의)</span>
            <strong>$1 = {USD_KRW.toLocaleString()}원</strong>
          </div>
        )}
      </div>

      {category !== "futures" && orderTaxPreview.grossAmount > 0 && (
        <section className="order-tax-preview" aria-label="예상 수수료와 세금">
          <div className="order-tax-preview-head">
            <strong>예상 비용</strong>
            <span>{TRADE_TAX_RULES_AS_OF.slice(0, 4)}년 기준 · 체결가에 따라 변동</span>
          </div>
          <dl>
            <div><dt>주문금액</dt><dd>{money(orderTaxPreview.grossAmount)}</dd></div>
            <div><dt>수수료 ({(orderTaxPreview.feeRate * 100).toFixed(3)}%)</dt><dd>-{money(orderTaxPreview.feeAmount)}</dd></div>
            {orderTaxPreview.transactionTaxAmount > 0 && <div><dt>증권거래세 ({(orderTaxPreview.transactionTaxRate * 100).toFixed(2)}%)</dt><dd>-{money(orderTaxPreview.transactionTaxAmount)}</dd></div>}
            {orderTaxPreview.agriculturalTaxAmount > 0 && <div><dt>농어촌특별세 ({(orderTaxPreview.agriculturalTaxRate * 100).toFixed(2)}%)</dt><dd>-{money(orderTaxPreview.agriculturalTaxAmount)}</dd></div>}
            <div className="order-tax-preview-total"><dt>체결 후 순결제 예상</dt><dd className={orderTaxPreview.settlementAmount >= 0 ? "up" : "down"}>{orderTaxPreview.settlementAmount >= 0 ? "+" : "-"}{money(Math.abs(orderTaxPreview.settlementAmount))}</dd></div>
            {orderTaxPreview.deferredLabel && <div className="order-tax-preview-deferred"><dt>{orderTaxPreview.deferredLabel}</dt><dd>{orderTaxPreview.deferredTaxAmount > 0 ? `약 ${money(orderTaxPreview.deferredTaxAmount)}` : "별도 과세"}</dd></div>}
          </dl>
          {orderTaxPreview.deferredNote && <p>{orderTaxPreview.deferredNote}</p>}
        </section>
      )}

      <div className="order-submit">
        <button
          type="button"
          className={orderSide === "BUY" ? "buy" : "sell"}
          disabled={!accountReady || accountLoading || orderBusy || Boolean(busyOrderId)}
          onClick={reviewOrder}
        >
          {category === "futures"
            ? `${orderSide === "BUY" ? "매수 LONG" : "매도 SHORT"} 주문`
            : `${orderSide === "BUY" ? "매수" : "매도"} 주문`}
        </button>
      </div>

      <div className="message"><b>주문 알림</b>{message}</div>
        </>
      )}

      {orderTab === "pending" && (
        <div className="order-status-list">
          {pendingOrders.length === 0 ? <div className="order-status-empty">미체결 주문이 없습니다.</div> : pendingOrders.map((order) => (
            <article key={order.id} className="order-status-item">
              <div><strong>{order.name}</strong><span>{order.symbol} · {order.orderedAt}</span></div>
              <div><b className={order.side === "BUY" ? "up" : "down"}>{order.side === "BUY" ? "매수" : "매도"}</b><strong>{order.quantity} · {assetPrice({ ...allAssets.find((item) => item.id === order.assetId), price: order.limitPrice })}</strong></div>
              <div className="order-item-actions"><button type="button" disabled={Boolean(busyOrderId) || orderBusy} onClick={() => reviewPendingOrder("amend", order)}>정정</button><button type="button" disabled={Boolean(busyOrderId) || orderBusy} onClick={() => reviewPendingOrder("cancel", order)}>취소</button></div>
            </article>
          ))}
        </div>
      )}

      {orderTab === "filled" && (
        <div className="order-status-list">
          {filledOrders.length === 0 ? <div className="order-status-empty">체결 주문이 없습니다.</div> : filledOrders.map((order) => (
            <article key={order.id} className="order-status-item is-filled">
              <div><strong>{order.name}</strong><span>{order.symbol} · {order.filledAt}</span></div>
              <div><b className={order.side === "BUY" ? "up" : "down"}>{order.side === "BUY" ? "매수" : "매도"}</b><strong>{order.quantity} · {assetPrice({ ...allAssets.find((item) => item.id === order.assetId), price: order.executionPrice })}</strong></div>
              <em>{order.orderType === "LIMIT" ? "지정가" : "시장가"} 체결 · 수수료 {money(order.feeAmount || 0)}{order.taxAmount > 0 ? ` · 세금 ${money(order.taxAmount)}` : ""}</em>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
