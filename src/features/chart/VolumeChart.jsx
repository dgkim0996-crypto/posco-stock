import React from "react";
import { VOLUME_HEIGHTS } from "./chartConstants.js";

export default function VolumeChart({ prepared, asset, volumeLevel, setVolumeLevel }) {
  const { w, volumeHeight, volumes, maxVolume, clean, coords, plotW } = prepared;
  const volumeSvgHeight = volumeHeight + 28;
  const volumeBarTop = 20;
  const volumeBarBottom = volumeSvgHeight - 6;
  return (
    <section className="volume-chart-panel" aria-label="거래량 차트">
      <header className="volume-chart-head">
        <strong>거래량</strong>
        <div className="chart-volume-controls" aria-label="거래량 차트 크기 조절">
          <span>크기</span>
          <button
            type="button"
            aria-label="거래량 차트 줄이기"
            title="거래량 차트 줄이기"
            disabled={volumeLevel === 0}
            onClick={() => setVolumeLevel((level) => Math.max(0, level - 1))}
          >
            −
          </button>
          <button
            type="button"
            aria-label="거래량 차트 늘리기"
            title="거래량 차트 늘리기"
            disabled={volumeLevel === VOLUME_HEIGHTS.length - 1}
            onClick={() => setVolumeLevel((level) => Math.min(VOLUME_HEIGHTS.length - 1, level + 1))}
          >
            +
          </button>
        </div>
      </header>
      <svg className="volume-sparkline" viewBox={`0 0 ${w} ${volumeSvgHeight}`} preserveAspectRatio="none" role="img" aria-label={`${asset?.name || "종목"} 거래량`}>
        {volumes.map((volume, index) => {
          const barHeight = Math.max(2, (volume / maxVolume) * (volumeBarBottom - volumeBarTop));
          const rising = index === 0 || clean[index] >= clean[index - 1];
          return (
            <rect
              key={`volume-${index}`}
              x={coords[index].x - Math.max(0.4, plotW / clean.length / 3)}
              y={volumeBarBottom - barHeight}
              width={Math.max(0.8, plotW / clean.length / 1.8)}
              height={barHeight}
              rx="1"
              className={rising ? "volume-bar up-bar" : "volume-bar down-bar"}
            />
          );
        })}
      </svg>
    </section>
  );
}
