import React, { useMemo, useRef, useState } from "react";

const PERIOD_MS = {
  tick: 1500,
  "1m": 60_000,
  "5m": 300_000,
  day: 86_400_000,
};

function formatAxisPrice(value, asset) {
  if (!Number.isFinite(value)) return "-";
  if (asset?.unit === "USD") {
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 })}`;
  }
  if (asset?.unit === "PTS") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (Math.abs(value) >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (Math.abs(value) >= 10000) return `${Math.round(value / 1000).toLocaleString()}천`;
  return Math.round(value).toLocaleString();
}

function formatFullPrice(value, asset) {
  if (asset?.unit === "USD") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (asset?.unit === "PTS") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${Math.round(value).toLocaleString()}원`;
}

function formatTime(date, period) {
  if (period === "day") return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  if (period === "tick") {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function Sparkline({ values, asset, period = "tick" }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const containerRef = useRef(null);

  const prepared = useMemo(() => {
    const clean = (values || []).filter(Number.isFinite);
    if (clean.length < 2) return null;

    const w = 920;
    const h = 360;
    const left = 18;
    const right = 92;
    const top = 20;
    const priceBottom = 270;
    const volumeTop = 292;
    const volumeBottom = 326;
    const axisBottom = 348;
    const plotW = w - left - right;
    const plotH = priceBottom - top;

    const rawMin = Math.min(...clean);
    const rawMax = Math.max(...clean);
    const rawRange = rawMax - rawMin || Math.abs(rawMax || 1) * 0.01 || 1;
    const padding = rawRange * 0.12;
    const min = rawMin - padding;
    const max = rawMax + padding;
    const range = max - min || 1;

    const coords = clean.map((value, index) => ({
      value,
      x: left + (index / (clean.length - 1)) * plotW,
      y: top + ((max - value) / range) * plotH,
    }));

    const volumes = clean.map((value, index) => {
      const prev = clean[Math.max(0, index - 1)];
      return Math.abs(value - prev) / (Math.abs(prev) || 1);
    });
    const maxVolume = Math.max(...volumes, 0.000001);
    const interval = PERIOD_MS[period] || PERIOD_MS.tick;
    const now = Date.now();
    const times = clean.map((_, index) => new Date(now - (clean.length - 1 - index) * interval));

    return { clean, w, h, left, right, top, priceBottom, volumeTop, volumeBottom, axisBottom, plotW, plotH, min, max, range, coords, volumes, maxVolume, times };
  }, [values, period]);

  if (!prepared) {
    return <div className="chart-empty">시세 데이터를 수신하고 있습니다...</div>;
  }

  const { clean, w, h, left, top, priceBottom, volumeTop, volumeBottom, axisBottom, plotW, min, max, range, coords, volumes, maxVolume, times } = prepared;
  const up = clean.at(-1) >= clean[0];
  const linePoints = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints = `${left},${priceBottom} ${linePoints} ${left + plotW},${priceBottom}`;
  const yTicks = Array.from({ length: 6 }, (_, i) => max - (range * i) / 5);
  const xTickIndexes = Array.from(new Set([0, Math.round((clean.length - 1) * 0.25), Math.round((clean.length - 1) * 0.5), Math.round((clean.length - 1) * 0.75), clean.length - 1]));
  const active = hoverIndex == null ? clean.length - 1 : hoverIndex;
  const activePoint = coords[active];
  const activeTime = times[active];

  function handlePointerMove(event) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = ((event.clientX - rect.left) / rect.width) * w;
    const ratio = Math.max(0, Math.min(1, (svgX - left) / plotW));
    setHoverIndex(Math.round(ratio * (clean.length - 1)));
  }

  return (
    <div
      className="market-chart-wrap"
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoverIndex(null)}
    >
      <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${asset?.name || "종목"} 모의 시세 차트`}>
        <defs>
          <linearGradient id="chartAreaUp" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#e5484d" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#e5484d" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="chartAreaDown" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2f6fed" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#2f6fed" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick, index) => {
          const y = top + (index / 5) * (priceBottom - top);
          return (
            <g key={tick}>
              <line x1={left} y1={y} x2={left + plotW} y2={y} className="grid-line" />
              <text x={left + plotW + 10} y={y + 4} className="chart-axis-text">{formatAxisPrice(tick, asset)}</text>
            </g>
          );
        })}

        {xTickIndexes.map((index) => {
          const x = coords[index].x;
          return (
            <g key={index}>
              <line x1={x} y1={top} x2={x} y2={volumeBottom} className="grid-line chart-grid-vertical" />
              <text x={x} y={axisBottom} textAnchor={index === 0 ? "start" : index === clean.length - 1 ? "end" : "middle"} className="chart-axis-text chart-time-text">
                {formatTime(times[index], period)}
              </text>
            </g>
          );
        })}

        <polygon points={areaPoints} fill={up ? "url(#chartAreaUp)" : "url(#chartAreaDown)"} />

        {volumes.map((volume, index) => {
          const barHeight = Math.max(2, (volume / maxVolume) * (volumeBottom - volumeTop));
          const rising = index === 0 || clean[index] >= clean[index - 1];
          return (
            <rect
              key={`v-${index}`}
              x={coords[index].x - Math.max(1.2, plotW / clean.length / 3)}
              y={volumeBottom - barHeight}
              width={Math.max(2.4, plotW / clean.length / 1.8)}
              height={barHeight}
              rx="1"
              className={rising ? "volume-bar up-bar" : "volume-bar down-bar"}
            />
          );
        })}
        <text x={left} y={volumeTop - 7} className="chart-volume-label">거래량(모의)</text>

        <polyline
          points={linePoints}
          fill="none"
          stroke={up ? "#e5484d" : "#2f6fed"}
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {activePoint && (
          <g className="chart-crosshair">
            <line x1={activePoint.x} y1={top} x2={activePoint.x} y2={volumeBottom} />
            <line x1={left} y1={activePoint.y} x2={left + plotW} y2={activePoint.y} />
            <circle cx={activePoint.x} cy={activePoint.y} r="4" />
            <rect x={left + plotW + 4} y={activePoint.y - 12} width="82" height="24" rx="5" className="chart-floating-label" />
            <text x={left + plotW + 45} y={activePoint.y + 4} textAnchor="middle" className="chart-floating-text">{formatAxisPrice(activePoint.value, asset)}</text>
            <rect x={Math.max(left, Math.min(left + plotW - 92, activePoint.x - 46))} y={axisBottom - 15} width="92" height="20" rx="5" className="chart-time-label" />
            <text x={Math.max(left + 46, Math.min(left + plotW - 46, activePoint.x))} y={axisBottom - 1} textAnchor="middle" className="chart-time-floating-text">{formatTime(activeTime, period)}</text>
          </g>
        )}
      </svg>

      <div className={`chart-hover-card ${up ? "is-up" : "is-down"}`}>
        <span>{formatTime(activeTime, period)}</span>
        <strong>{formatFullPrice(clean[active], asset)}</strong>
      </div>
    </div>
  );
}
