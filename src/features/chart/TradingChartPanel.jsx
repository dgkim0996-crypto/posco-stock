import { CHART_INDICATOR_OPTIONS } from "./chartOptions.js";
import Sparkline from "../../components/Sparkline.jsx";
import { assetPrice } from "../../utils/tradingFormatters.js";
import React from "react";

export default function TradingChartPanel({
  chartPeriod, setChartPeriod, chartIndicators, setChartIndicators, chartLoading, chartData, selected,
  chartError, selectedAveragePrice, selectedTradeMarkers,
}) {
  return (
    <div className="panel chart-panel">
      <div className="chart-head">
        <div className="chart-periods">
          <strong>종합차트</strong>
          {[
            ["1m", "1분"],
            ["5m", "5분"],
            ["30m", "30분"],
            ["60m", "60분"],
            ["day", "일"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={chartPeriod === key ? "active" : ""}
              onClick={() => setChartPeriod(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span>휠 확대·축소 · 본문 이동 · 하단 시간축/우측 가격축 조절</span>
        <details className="chart-indicator-menu">
          <summary>
            보조지표
            {chartIndicators.length > 0 && <b>{chartIndicators.length}</b>}
          </summary>
          <div className="chart-indicator-popover">
            <div className="chart-indicator-popover-head">
              <strong>보조지표</strong>
              <span>필요한 지표만 선택하세요</span>
            </div>
            {CHART_INDICATOR_OPTIONS.map((option) => {
              const selectedIndicator = chartIndicators.includes(option.key);
              return (
                <button
                  type="button"
                  key={option.key}
                  className={selectedIndicator ? "active" : ""}
                  aria-pressed={selectedIndicator}
                  onClick={() => setChartIndicators((current) => (
                    current.includes(option.key)
                      ? current.filter((key) => key !== option.key)
                      : [...current, option.key]
                  ))}
                >
                  <span className={`chart-indicator-swatch ${option.key}`} aria-hidden="true" />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <em aria-hidden="true">{selectedIndicator ? "✓" : "+"}</em>
                </button>
              );
            })}
          </div>
        </details>
      </div>
      {chartLoading && !chartData[`${selected.symbol}:${chartPeriod}`] ? (
        <div className="chart-empty">실제 {chartPeriod === "day" ? "일봉" : `${chartPeriod}봉`}을 불러오고 있습니다...</div>
      ) : chartError && !chartData[`${selected.symbol}:${chartPeriod}`] ? (
        <div className="chart-empty">{chartError}</div>
      ) : (
        <Sparkline
          candles={chartData[`${selected.symbol}:${chartPeriod}`] || null}
          values={chartData[selected.id] ?? [selected.price]}
          asset={selected}
          period={chartPeriod}
          averagePrice={selectedAveragePrice}
          tradeMarkers={selectedTradeMarkers}
          indicators={chartIndicators}
        />
      )}
      <div className="chart-foot">
        <span>시가 {assetPrice({ ...selected, price: selected.open ?? selected.price })}</span>
        <span>고가 {assetPrice({ ...selected, price: selected.high ?? selected.price * 1.006 })}</span>
        <span>저가 {assetPrice({ ...selected, price: selected.low ?? selected.price * 0.994 })}</span>
        <span>거래량 {(selected.volume ?? Math.abs(Math.round(selected.price)) % 900000 + 120000).toLocaleString()}</span>
      </div>
    </div>
  );
}
