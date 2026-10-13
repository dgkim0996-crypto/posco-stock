import React from "react";
import { linePath } from "./chartPaths.js";

export default function ChartIndicatorPanels({ prepared }) {
  const { indicatorPanels, indicatorSeries, coords, left, plotW, clean } = prepared;
  const rsiPanel = indicatorPanels.rsi;
  const rsiToY = (value) => rsiPanel.top + ((100 - value) / 100) * (rsiPanel.bottom - rsiPanel.top);
  const rsiPath = rsiPanel ? linePath(indicatorSeries.rsi, coords, rsiToY) : "";
  const latestRsi = [...indicatorSeries.rsi].reverse().find(Number.isFinite);
  const macdPanel = indicatorPanels.macd;
  const macdValues = macdPanel
    ? [...indicatorSeries.macd.macd, ...indicatorSeries.macd.signal, ...indicatorSeries.macd.histogram].filter(Number.isFinite)
    : [];
  const macdExtent = Math.max(...macdValues.map((value) => Math.abs(value)), Number.EPSILON);
  const macdToY = (value) => macdPanel.top + ((macdExtent - value) / (macdExtent * 2)) * (macdPanel.bottom - macdPanel.top);
  const macdPath = macdPanel ? linePath(indicatorSeries.macd.macd, coords, macdToY) : "";
  const signalPath = macdPanel ? linePath(indicatorSeries.macd.signal, coords, macdToY) : "";
  const latestMacd = [...indicatorSeries.macd.macd].reverse().find(Number.isFinite);

  return (
    <>
      {rsiPanel && (
        <g className="chart-indicator-panel chart-rsi-panel">
          <rect className="chart-indicator-background" x={left} y={rsiPanel.top} width={plotW} height={rsiPanel.bottom - rsiPanel.top} />
          {[70, 50, 30].map((level) => (
            <line
              key={level}
              x1={left}
              y1={rsiToY(level)}
              x2={left + plotW}
              y2={rsiToY(level)}
              className={level === 50 ? "indicator-mid-line" : "indicator-guide-line"}
            />
          ))}
          <text x={left + 5} y={rsiPanel.top + 13} className="chart-indicator-label">
            RSI 14{Number.isFinite(latestRsi) ? `  ${latestRsi.toFixed(1)}` : ""}
          </text>
          <text x={left + plotW + 10} y={rsiToY(70) + 3} className="chart-indicator-axis">70</text>
          <text x={left + plotW + 10} y={rsiToY(30) + 3} className="chart-indicator-axis">30</text>
          <path d={rsiPath} className="chart-indicator-line rsi" />
        </g>
      )}

      {macdPanel && (
        <g className="chart-indicator-panel chart-macd-panel">
          <rect className="chart-indicator-background" x={left} y={macdPanel.top} width={plotW} height={macdPanel.bottom - macdPanel.top} />
          <line x1={left} y1={macdToY(0)} x2={left + plotW} y2={macdToY(0)} className="indicator-mid-line" />
          {indicatorSeries.macd.histogram.map((value, index) => {
            if (!Number.isFinite(value)) return null;
            const zeroY = macdToY(0);
            const valueY = macdToY(value);
            return (
              <rect
                key={`macd-volume-${index}`}
                x={coords[index].x - Math.max(0.4, plotW / clean.length / 3)}
                y={Math.min(zeroY, valueY)}
                width={Math.max(0.8, plotW / clean.length / 1.8)}
                height={Math.max(0.8, Math.abs(zeroY - valueY))}
                className={value >= 0 ? "macd-bar positive" : "macd-bar negative"}
              />
            );
          })}
          <text x={left + 5} y={macdPanel.top + 13} className="chart-indicator-label">
            MACD 12·26·9{Number.isFinite(latestMacd) ? `  ${latestMacd.toFixed(2)}` : ""}
          </text>
          <path d={macdPath} className="chart-indicator-line macd" />
          <path d={signalPath} className="chart-indicator-line signal" />
        </g>
      )}

    </>
  );
}
