import React, { useId, useMemo, useState } from "react";
import { DEFAULT_VOLUME_LEVEL } from "../features/chart/chartConstants.js";
import { normalizeCandles, prepareChart } from "../features/chart/chartData.js";
import { calculateIndicators } from "../features/chart/chartIndicators.js";
import { formatFullPrice, formatTime } from "../features/chart/chartFormatters.js";
import { useChartViewport } from "../features/chart/useChartViewport.js";
import ChartPriceLayer from "../features/chart/ChartPriceLayer.jsx";
import ChartIndicatorPanels from "../features/chart/ChartIndicatorPanels.jsx";
import ChartCrosshair from "../features/chart/ChartCrosshair.jsx";
import VolumeChart from "../features/chart/VolumeChart.jsx";

// Compose normalized candle data, viewport interactions, and unchanged SVG layers.
export default function Sparkline({ values, candles, asset, period = "1m", averagePrice = null, tradeMarkers = [], indicators = [] }) {
  const [volumeLevel, setVolumeLevel] = useState(DEFAULT_VOLUME_LEVEL);
  const priceClipId = `chart-price-${useId().replaceAll(":", "")}`;
  const indicatorSignature = [...indicators].sort().join(",");
  const allCandles = useMemo(() => normalizeCandles({ values, candles, period }), [values, candles, period]);
  const indicatorData = useMemo(() => calculateIndicators(allCandles), [allCandles]);
  const viewport = useChartViewport({ candleCount: allCandles.length, assetId: asset?.id, period });
  const { hoverIndex, viewRange, priceScale, svgRef, dragRef } = viewport;
  const prepared = useMemo(() => prepareChart({
    allCandles, viewRange, priceScale, volumeLevel, averagePrice, tradeMarkers, period, indicatorData, indicators,
  }), [allCandles, viewRange, priceScale, volumeLevel, averagePrice, tradeMarkers, period, indicatorData, indicatorSignature]);

  if (!prepared) {
    return <div className="chart-empty">시세 데이터를 수신하고 있습니다...</div>;
  }

  const { clean, w, h, times, volumeHeight } = prepared;
  const enabledIndicators = new Set(indicators);
  const up = clean.at(-1) >= clean[0];
  const active = hoverIndex == null ? clean.length - 1 : Math.min(hoverIndex, clean.length - 1);
  const activeTime = times[active];
  const volumeSvgHeight = volumeHeight + 28;

  return (
    <div
      className="market-chart-wrap"
      style={{
        // Include price/volume charts, the volume header, and spacing between panels.
        "--chart-height": `${h + volumeSvgHeight + 140}px`,
        "--price-chart-height": `${h}px`,
        "--volume-chart-height": `${volumeSvgHeight}px`,
      }}
    >
      <svg
        ref={svgRef}
        className={`sparkline ${dragRef.current ? "is-dragging" : ""}`}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${asset?.name || "종목"} 모의 시세 차트`}
        {...viewport.getPointerHandlers(prepared)}
      >
        <ChartPriceLayer prepared={prepared} asset={asset} period={period} priceScale={priceScale} priceClipId={priceClipId} indicators={indicators} />
        <ChartIndicatorPanels prepared={prepared} />
        <ChartCrosshair prepared={prepared} active={active} asset={asset} period={period} />
      </svg>

      <VolumeChart prepared={prepared} asset={asset} volumeLevel={volumeLevel} setVolumeLevel={setVolumeLevel} />

      {(enabledIndicators.has("ma5") || enabledIndicators.has("ma20") || enabledIndicators.has("bollinger")) && (
        <div className="chart-indicator-legend" aria-label="차트에 표시 중인 가격 보조지표">
          {enabledIndicators.has("ma5") && <span className="ma5">MA5</span>}
          {enabledIndicators.has("ma20") && <span className="ma20">MA20</span>}
          {enabledIndicators.has("bollinger") && <span className="bollinger">볼린저 20·2</span>}
        </div>
      )}

      <div className={`chart-hover-card ${up ? "is-up" : "is-down"}`}>
        <span>{formatTime(activeTime, period)}</span>
        <strong>{formatFullPrice(clean[active], asset)}</strong>
      </div>
    </div>
  );
}
