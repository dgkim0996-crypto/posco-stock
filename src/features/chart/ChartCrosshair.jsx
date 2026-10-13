import React from "react";
import { PRICE_TICK_COUNT } from "./chartConstants.js";
import { formatAxisPrice, formatTime } from "./chartFormatters.js";

export default function ChartCrosshair({ prepared, active, asset, period }) {
  const { coords, times, range, left, top, plotW, contentBottom, axisBottom } = prepared;
  const activePoint = coords[active];
  const activeTime = times[active];
  const priceTickStep = range / (PRICE_TICK_COUNT - 1);
  return (
    <>
      {activePoint && (
        <g className="chart-crosshair">
          <line x1={activePoint.x} y1={top} x2={activePoint.x} y2={contentBottom} />
          <line x1={left} y1={activePoint.y} x2={left + plotW} y2={activePoint.y} />
          <circle cx={activePoint.x} cy={activePoint.y} r="4" />
          <rect x={left + plotW + 4} y={activePoint.y - 12} width="82" height="24" rx="5" className="chart-floating-label" />
          <text x={left + plotW + 45} y={activePoint.y + 4} textAnchor="middle" className="chart-floating-text">{formatAxisPrice(activePoint.value, asset, priceTickStep)}</text>
          <rect x={Math.max(left, Math.min(left + plotW - 92, activePoint.x - 46))} y={axisBottom - 15} width="92" height="20" rx="5" className="chart-time-label" />
          <text x={Math.max(left + 46, Math.min(left + plotW - 46, activePoint.x))} y={axisBottom - 1} textAnchor="middle" className="chart-time-floating-text">{formatTime(activeTime, period)}</text>
        </g>
      )}
    </>
  );
}
