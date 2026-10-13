import React from "react";
import { PRICE_TICK_COUNT } from "./chartConstants.js";
import { formatAxisPrice, formatFullPrice, formatTime } from "./chartFormatters.js";
import { bandAreaPath, linePath } from "./chartPaths.js";

export default function ChartPriceLayer({ prepared, asset, period, priceScale, priceClipId, indicators }) {
  const { normalized, clean, w, left, top, priceBottom, indicatorSeries, axisBottom, plotW, max, range, coords, times, averageY, averagePriceValue, tradeMarkerCoords } = prepared;
  const enabledIndicators = new Set(indicators);
  const priceTickStep = range / (PRICE_TICK_COUNT - 1);
  const yTicks = Array.from({ length: PRICE_TICK_COUNT }, (_, i) => max - priceTickStep * i);
  const xTickIndexes = Array.from(new Set([0, Math.round((clean.length - 1) * 0.25), Math.round((clean.length - 1) * 0.5), Math.round((clean.length - 1) * 0.75), clean.length - 1]));
  const priceToY = (value) => top + ((max - value) / range) * (priceBottom - top);
  // The average-price guide appears only inside the current automatic price range.
  const isAveragePriceVisible = Number.isFinite(averageY) && averageY >= top && averageY <= priceBottom;

  return (
    <>
      <defs>
        <linearGradient id="chartAreaUp" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#e5484d" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#e5484d" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="chartAreaDown" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#2f6fed" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#2f6fed" stopOpacity="0" />
        </linearGradient>
        <clipPath id={priceClipId}>
          <rect x={left} y={top} width={plotW} height={priceBottom - top} />
        </clipPath>
      </defs>

      <rect
        x={left + plotW}
        y={top}
        width={w - left - plotW}
        height={priceBottom - top}
        className="chart-price-axis-hitarea"
      />

      {yTicks.map((tick, index) => {
        const y = top + (index / (PRICE_TICK_COUNT - 1)) * (priceBottom - top);
        return (
          <g key={tick}>
            <line x1={left} y1={y} x2={left + plotW} y2={y} className="grid-line" />
            <text x={left + plotW + 10} y={y + 4} className="chart-axis-text">{formatAxisPrice(tick, asset, priceTickStep)}</text>
          </g>
        );
      })}

      <text x={w - 7} y={priceBottom + 15} textAnchor="end" className="chart-price-scale-status">
        {priceScale === 1 ? "가격축 자동" : `가격축 ${priceScale.toFixed(2)}x`}
      </text>

      {xTickIndexes.map((index) => {
        const x = coords[index].x;
        return (
          <g key={index}>
            <line x1={x} y1={top} x2={x} y2={priceBottom} className="grid-line chart-grid-vertical" />
            <text x={x} y={axisBottom} textAnchor={index === 0 ? "start" : index === clean.length - 1 ? "end" : "middle"} className="chart-axis-text chart-time-text">
              {formatTime(times[index], period)}
            </text>
          </g>
        );
      })}

      <g className="chart-price-indicators" clipPath={`url(#${priceClipId})`}>
        {enabledIndicators.has("bollinger") && (
          <>
            <path
              d={bandAreaPath(indicatorSeries.bollinger.upper, indicatorSeries.bollinger.lower, coords, priceToY)}
              className="chart-bollinger-area"
            />
            <path d={linePath(indicatorSeries.bollinger.upper, coords, priceToY)} className="chart-indicator-line bollinger" />
            <path d={linePath(indicatorSeries.bollinger.lower, coords, priceToY)} className="chart-indicator-line bollinger" />
          </>
        )}
        {enabledIndicators.has("ma5") && (
          <path d={linePath(indicatorSeries.ma5, coords, priceToY)} className="chart-indicator-line ma5" />
        )}
        {enabledIndicators.has("ma20") && (
          <path d={linePath(indicatorSeries.ma20, coords, priceToY)} className="chart-indicator-line ma20" />
        )}
      </g>

      {isAveragePriceVisible && (
        <g className="chart-average-guide">
          <line className="chart-average-line" x1={left} y1={averageY} x2={left + plotW} y2={averageY} />
          <rect
            className="chart-average-caption-bg"
            x={left + plotW * 0.62 - 42}
            y={averageY - 10}
            width="84"
            height="20"
            rx="6"
          />
          <text className="chart-average-caption" x={left + plotW * 0.62} y={averageY + 3.5} textAnchor="middle">나의 평단</text>
          <rect className="chart-average-price-bg" x={left + plotW + 4} y={averageY - 11} width="84" height="22" rx="6" />
          <text className="chart-average-price" x={left + plotW + 46} y={averageY + 4} textAnchor="middle">
            {formatFullPrice(averagePriceValue, asset)}
          </text>
        </g>
      )}

      {normalized.map((item, index) => {
        const x = coords[index].x;
        const bodyWidth = Math.max(0.8, Math.min(10, plotW / normalized.length * 0.58));
        const highY = top + ((max - item.high) / range) * (priceBottom - top);
        const lowY = top + ((max - item.low) / range) * (priceBottom - top);
        const openY = top + ((max - item.open) / range) * (priceBottom - top);
        const closeY = top + ((max - item.close) / range) * (priceBottom - top);
        const rising = item.close >= item.open;
        return (
          <g key={`c-${item.time.toISOString()}-${index}`} className={rising ? "candle-up" : "candle-down"}>
            <line x1={x} y1={highY} x2={x} y2={lowY} stroke={rising ? "#e5484d" : "#2f6fed"} strokeWidth="1.3" />
            <rect x={x - bodyWidth / 2} y={Math.min(openY, closeY)} width={bodyWidth} height={Math.max(1.5, Math.abs(closeY - openY))} fill={rising ? "#e5484d" : "#2f6fed"} />
          </g>
        );
      })}

      {tradeMarkerCoords.map((marker, index) => {
        const isBuy = marker.side === "BUY";
        const markerX = Math.max(left + 22, Math.min(left + plotW - 22, marker.x));
        const placeBelow = isBuy ? marker.y < priceBottom - 30 : marker.y <= top + 30;
        const labelY = placeBelow ? marker.y + 9 : marker.y - 27;
        const connectorY = placeBelow ? labelY : labelY + 18;
        return (
          <g className={`chart-trade-marker ${isBuy ? "is-buy" : "is-sell"}`} key={`${marker.id || marker.time}-${index}`}>
            <title>{`${isBuy ? "매수" : "매도"} ${marker.quantity || ""} · ${formatFullPrice(marker.price, asset)}`}</title>
            <circle cx={marker.x} cy={marker.y} r="3.5" />
            <line x1={marker.x} y1={marker.y} x2={markerX} y2={connectorY} />
            <rect x={markerX - 20} y={labelY} width="40" height="18" rx="6" />
            <text x={markerX} y={labelY + 12.5} textAnchor="middle">{isBuy ? "BUY" : "SELL"}</text>
          </g>
        );
      })}

    </>
  );
}
