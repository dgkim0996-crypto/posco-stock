import { spotPriceInKRW } from "../market/marketHelpers.js";
import AssetLogo from "../../components/AssetLogo.jsx";
import { money, assetPrice } from "../../utils/tradingFormatters.js";
import { DASHBOARD_META } from "./dashboardConstants.js";
import { futuresPositionPnl } from "../account/usePortfolio.js";
import React from "react";

export default function InvestmentDashboard({
  spotPositions, shortPositions, allAssets, futuresPositions, markets, closeFuture, trades, editDashboard,
  resetDashboardLayout, setEditDashboard, dashboardWidgets, updateDashboardWidget, dragOverWidget,
  resizingWidget, setDragOverWidget, draggingWidget, moveDashboardWidget, setDraggingWidget,
  startDashboardResize,
}) {
  function renderDashboardContent(widgetId) {
    if (widgetId === "holdings") {
      return (
        <div className="table-wrap dashboard-table-wrap">
          <table>
            <thead>
              <tr><th>종목명</th><th>보유수량</th><th>평균단가</th><th>현재가</th><th>평가금액</th><th>평가손익</th></tr>
            </thead>
            <tbody>
              {Object.keys(spotPositions).length === 0 && Object.keys(shortPositions).length === 0 ? (
                <tr><td colSpan="6" className="empty">보유 중인 상품이 없습니다.</td></tr>
              ) : <>{Object.entries(spotPositions).map(([id, pos]) => {
                const asset = allAssets.find((x) => x.id === id);
                const currentPriceKRW = asset ? spotPriceInKRW(asset) : 0;
                const pnl = asset ? (currentPriceKRW - pos.avgPrice) * pos.quantity : 0;
                const valuation = asset ? currentPriceKRW * pos.quantity : 0;
                return (
                  <tr key={id}>
                    <td><div className="holding-asset-cell"><AssetLogo asset={asset} size="xs" /><div><strong>{asset?.name}</strong><span className="sub-code">{asset?.symbol}</span></div></div></td>
                    <td>{pos.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                    <td>{money(pos.avgPrice)}</td>
                    <td>{asset ? assetPrice(asset) : "-"}</td>
                    <td>{money(valuation)}</td>
                    <td className={pnl >= 0 ? "up" : "down"}>{money(pnl)}</td>
                  </tr>
                );
              })}{Object.entries(shortPositions).map(([id, pos]) => {
                const asset = allAssets.find((item) => item.id === id);
                const current = asset ? spotPriceInKRW(asset) : 0;
                const pnl = (pos.avgPrice - current) * pos.quantity;
                return <tr key={`short-${id}`}><td><div className="holding-asset-cell"><AssetLogo asset={asset} size="xs" /><div><strong>{asset?.name} <em>대주</em></strong><span className="sub-code">{asset?.symbol}</span></div></div></td><td className="down">-{pos.quantity.toLocaleString()}</td><td>{money(pos.avgPrice)}</td><td>{asset ? assetPrice(asset) : "-"}</td><td>{money(current * pos.quantity)}</td><td className={pnl >= 0 ? "up" : "down"}>{money(pnl)}</td></tr>;
              })}</>}
            </tbody>
          </table>
        </div>
      );
    }

    if (widgetId === "futures") {
      return (
        <div className="table-wrap dashboard-table-wrap">
          <table>
            <thead><tr><th>상품</th><th>구분</th><th>계약</th><th>진입가</th><th>평가손익</th><th></th></tr></thead>
            <tbody>
              {futuresPositions.length === 0 ? (
                <tr><td colSpan="6" className="empty">미결제 포지션이 없습니다.</td></tr>
              ) : futuresPositions.map((pos) => {
                const asset = markets.futures.find((x) => x.id === pos.assetId);
                const pnl = futuresPositionPnl(pos, asset);
                return (
                  <tr key={pos.id}>
                    <td>{pos.name}</td>
                    <td className={pos.side === "LONG" ? "up" : "down"}>{pos.side === "LONG" ? "매수" : "매도"}</td>
                    <td>{pos.quantity}</td>
                    <td>{pos.entryPrice.toLocaleString()}</td>
                    <td className={pnl == null ? undefined : pnl >= 0 ? "up" : "down"}>{pnl == null ? "-" : money(pnl)}</td>
                    <td><button className="close" onClick={() => closeFuture(pos.id)}>청산</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <div className="history dashboard-history">
        {trades.length === 0 ? (
          <div className="empty-block">오늘 체결된 주문이 없습니다.</div>
        ) : trades.map((trade) => (
          <div className="history-row" key={trade.id}>
            <span>{trade.time}</span>
            <strong>{trade.text}</strong>
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className={`dashboard-section ${editDashboard ? "is-editing" : ""}`}>
      <div className="dashboard-toolbar">
        <div>
          <span>MY 투자 화면</span>
          <strong>내가 원하는 순서와 크기로 배치</strong>
          {editDashboard && <small>⠿로 이동 · 카드 오른쪽 아래 모서리를 드래그해 가로·세로 크기 조절</small>}
        </div>
        <div className="dashboard-toolbar-actions">
          {editDashboard && (
            <button type="button" className="dashboard-reset" onClick={resetDashboardLayout}>기본 배치 복원</button>
          )}
          <button
            type="button"
            className={`dashboard-edit ${editDashboard ? "active" : ""}`}
            onClick={() => setEditDashboard((prev) => !prev)}
          >
            {editDashboard ? "편집 완료" : "내 화면 편집"}
          </button>
        </div>
      </div>

      {editDashboard && dashboardWidgets.some((widget) => widget.hidden) && (
        <div className="hidden-widget-tray">
          <span>숨긴 창</span>
          {dashboardWidgets.filter((widget) => widget.hidden).map((widget) => (
            <button
              type="button"
              key={widget.id}
              onClick={() => updateDashboardWidget(widget.id, { hidden: false, collapsed: false })}
            >
              + {DASHBOARD_META[widget.id].title}
            </button>
          ))}
        </div>
      )}

      <div className="dashboard-grid">
        {dashboardWidgets.filter((widget) => !widget.hidden).map((widget) => {
          const meta = DASHBOARD_META[widget.id];
          const dynamicDescription = widget.id === "futures"
            ? `${futuresPositions.length}건`
            : widget.id === "history"
              ? `최근 ${Math.min(trades.length, 40)}건`
              : meta.description;

          return (
            <article
              key={widget.id}
              className={`panel dashboard-widget ${widget.collapsed ? "is-collapsed" : ""} ${dragOverWidget === widget.id ? "drag-over" : ""} ${resizingWidget === widget.id ? "is-resizing" : ""}`}
              style={{
                gridColumn: `span ${widget.cols}`,
                height: widget.collapsed ? "auto" : `${widget.height}px`,
              }}
              onDragOver={(event) => {
                if (!editDashboard) return;
                event.preventDefault();
                setDragOverWidget(widget.id);
              }}
              onDrop={(event) => {
                if (!editDashboard) return;
                event.preventDefault();
                const sourceId = event.dataTransfer.getData("text/plain") || draggingWidget;
                moveDashboardWidget(sourceId, widget.id);
                setDraggingWidget(null);
                setDragOverWidget(null);
              }}
            >
              <div className="dashboard-widget-head">
                <div className="dashboard-widget-title">
                  {editDashboard && (
                    <span
                      className="drag-handle"
                      aria-label={`${meta.title} 이동`}
                      title="잡아서 순서 이동"
                      draggable
                      onDragStart={(event) => {
                        setDraggingWidget(widget.id);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", widget.id);
                      }}
                      onDragEnd={() => {
                        setDraggingWidget(null);
                        setDragOverWidget(null);
                      }}
                    >
                      ⠿
                    </span>
                  )}
                  <div>
                    <span>{meta.eyebrow}</span>
                    <strong>{meta.title}</strong>
                  </div>
                </div>
                <div className="dashboard-widget-actions">
                  <em>
                    {editDashboard
                      ? `${widget.cols}/12 · ${widget.height}px`
                      : dynamicDescription}
                  </em>
                  {editDashboard && (
                    <button
                      type="button"
                      onClick={() => updateDashboardWidget(widget.id, { hidden: true })}
                    >
                      숨기기
                    </button>
                  )}
                  <button
                    type="button"
                    className="collapse-widget"
                    aria-label={widget.collapsed ? `${meta.title} 펼치기` : `${meta.title} 접기`}
                    onClick={() => updateDashboardWidget(widget.id, { collapsed: !widget.collapsed })}
                  >
                    {widget.collapsed ? "＋" : "－"}
                  </button>
                </div>
              </div>

              {!widget.collapsed && (
                <div className="dashboard-widget-body">{renderDashboardContent(widget.id)}</div>
              )}

              {editDashboard && !widget.collapsed && (
                <button
                  type="button"
                  className="widget-resize-handle"
                  aria-label={`${meta.title} 크기 조절`}
                  title="오른쪽 아래 모서리를 드래그해 크기 조절"
                  onPointerDown={(event) => startDashboardResize(event, widget)}
                >
                  <span />
                </button>
              )}
            </article>
          );
        })}
      </div>

      {dashboardWidgets.every((widget) => widget.hidden) && (
        <div className="dashboard-empty-state">
          <strong>표시 중인 투자 창이 없습니다.</strong>
          <span>내 화면 편집에서 필요한 창을 다시 추가해 주세요.</span>
          <button type="button" onClick={resetDashboardLayout}>기본 배치로 되돌리기</button>
        </div>
      )}
    </section>
  );
}
