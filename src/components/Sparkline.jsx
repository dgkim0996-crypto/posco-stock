import React, { useEffect, useMemo, useRef, useState } from "react";

// SVG 캔들/거래량 차트. 데이터 정규화 → 좌표 계산 → 확대·이동·툴팁 렌더링 순으로 동작한다.

const PERIOD_MS = {
  "1m": 60_000,
  "5m": 300_000,
  "30m": 1_800_000,
  "60m": 3_600_000,
  day: 86_400_000,
};
const MAX_VISIBLE_CANDLES = 60;

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

// 툴팁에는 축보다 상세한 가격 단위를 표시한다.
function formatFullPrice(value, asset) {
  if (asset?.unit === "USD") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (asset?.unit === "PTS") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${Math.round(value).toLocaleString()}원`;
}

// 분봉은 시각, 일봉은 월/일 형식으로 하단 축을 표시한다.
function formatTime(date, period) {
  if (period === "day") return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function Sparkline({ values, candles, asset, period = "1m" }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [viewRange, setViewRange] = useState({ start: 0, end: 0 });
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  // 실제 OHLCV가 없으면 모의상품의 가격 배열을 가상 봉으로 변환한다.
  const allCandles = useMemo(() => {
    const interval = PERIOD_MS[period] || PERIOD_MS["1m"];
    const now = Date.now();
    return Array.isArray(candles) && candles.length
      ? candles.filter((item) => item && Number.isFinite(item.close)).map((item) => ({ ...item, time: new Date(item.time) }))
      : (values || []).filter(Number.isFinite).map((value, index, list) => ({
          time: new Date(now - (list.length - 1 - index) * interval),
          open: value,
          high: value,
          low: value,
          close: value,
          volume: 0,
        }));
  }, [values, candles, period]);

  // 종목이나 기간이 바뀌면 기간별 기본 봉 개수로 화면 범위를 초기화한다.
  useEffect(() => {
    const end = allCandles.length;
    const initialCount = Math.min(MAX_VISIBLE_CANDLES, end);
    setViewRange({ start: Math.max(0, end - initialCount), end });
    setHoverIndex(null);
  }, [asset?.id, period, allCandles.length]);

  // 표시 범위의 가격/거래량 최댓값과 각 봉의 SVG 좌표를 미리 계산한다.
  const prepared = useMemo(() => {
    const normalized = allCandles.slice(viewRange.start, viewRange.end || allCandles.length);
    const clean = normalized.map((item) => item.close);
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

    const rawMin = Math.min(...normalized.map((item) => item.low));
    const rawMax = Math.max(...normalized.map((item) => item.high));
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

    const volumes = normalized.map((item) => Number(item.volume) || 0);
    const maxVolume = Math.max(...volumes, 1);
    const times = normalized.map((item) => item.time);

    return { normalized, clean, w, h, left, right, top, priceBottom, volumeTop, volumeBottom, axisBottom, plotW, plotH, min, max, range, coords, volumes, maxVolume, times };
  }, [allCandles, viewRange]);

  if (!prepared) {
    return <div className="chart-empty">시세 데이터를 수신하고 있습니다...</div>;
  }

  const { normalized, clean, w, h, left, top, priceBottom, volumeTop, volumeBottom, axisBottom, plotW, min, max, range, coords, volumes, maxVolume, times } = prepared;
  const up = clean.at(-1) >= clean[0];
  const yTicks = Array.from({ length: 6 }, (_, i) => max - (range * i) / 5);
  const xTickIndexes = Array.from(new Set([0, Math.round((clean.length - 1) * 0.25), Math.round((clean.length - 1) * 0.5), Math.round((clean.length - 1) * 0.75), clean.length - 1]));
  const active = hoverIndex == null ? clean.length - 1 : Math.min(hoverIndex, clean.length - 1);
  const activePoint = coords[active];
  const activeTime = times[active];

  // 포인터 툴팁을 이동하고 드래그 중에는 차트 이동 또는 시간축 확대를 수행한다.
  function handlePointerMove(event) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (dragRef.current) {
      const baseCount = dragRef.current.end - dragRef.current.start;
      if (dragRef.current.mode === "scale") {
        const delta = event.clientX - dragRef.current.x;
        const nextCount = Math.max(8, Math.min(allCandles.length, MAX_VISIBLE_CANDLES, Math.round(baseCount * Math.exp(-delta / 220))));
        const center = dragRef.current.start + baseCount / 2;
        let start = Math.round(center - nextCount / 2);
        start = Math.max(0, Math.min(allCandles.length - nextCount, start));
        setViewRange({ start, end: start + nextCount });
      } else {
        const pointWidth = rect.width / Math.max(1, baseCount - 1);
        const shift = Math.round((dragRef.current.x - event.clientX) / pointWidth);
        if (shift !== 0) {
          const maxStart = Math.max(0, allCandles.length - baseCount);
          const start = Math.max(0, Math.min(maxStart, dragRef.current.start + shift));
          setViewRange({ start, end: start + baseCount });
        }
      }
      return;
    }
    const svgX = ((event.clientX - rect.left) / rect.width) * w;
    const ratio = Math.max(0, Math.min(1, (svgX - left) / plotW));
    setHoverIndex(Math.round(ratio * (clean.length - 1)));
  }

  // 마우스 위치를 중심으로 화면에 보이는 봉 개수를 조절한다.
  function zoom(factor, centerRatio = 0.5) {
    const total = allCandles.length;
    const currentCount = viewRange.end - viewRange.start;
    const nextCount = Math.max(8, Math.min(total, MAX_VISIBLE_CANDLES, Math.round(currentCount * factor)));
    const center = viewRange.start + currentCount * centerRatio;
    let start = Math.round(center - nextCount * centerRatio);
    start = Math.max(0, Math.min(total - nextCount, start));
    setViewRange({ start, end: start + nextCount });
    setHoverIndex(null);
  }

  function handleWheel(event) {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    const ratio = rect ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0.5;
    zoom(event.deltaY < 0 ? 0.8 : 1.25, ratio);
  }

  // 더블클릭 시 사용자가 조절한 범위를 전체 기간으로 복원한다.
  function resetRange() {
    setViewRange({ start: Math.max(0, allCandles.length - MAX_VISIBLE_CANDLES), end: allCandles.length });
    setHoverIndex(null);
  }

  return (
    <div className="market-chart-wrap">
      <svg
        ref={svgRef}
        className={`sparkline ${dragRef.current ? "is-dragging" : ""}`}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${asset?.name || "종목"} 모의 시세 차트`}
        onWheel={handleWheel}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const svgY = ((event.clientY - rect.top) / rect.height) * h;
          dragRef.current = {
            mode: svgY >= axisBottom - 18 ? "scale" : "pan",
            x: event.clientX,
            start: viewRange.start,
            end: viewRange.end,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { dragRef.current = null; }}
        onPointerLeave={() => { if (!dragRef.current) setHoverIndex(null); }}
        onDoubleClick={resetRange}
      >
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


        {volumes.map((volume, index) => {
          const barHeight = Math.max(2, (volume / maxVolume) * (volumeBottom - volumeTop));
          const rising = index === 0 || clean[index] >= clean[index - 1];
          return (
            <rect
              key={`v-${index}`}
              x={coords[index].x - Math.max(0.4, plotW / clean.length / 3)}
              y={volumeBottom - barHeight}
              width={Math.max(0.8, plotW / clean.length / 1.8)}
              height={barHeight}
              rx="1"
              className={rising ? "volume-bar up-bar" : "volume-bar down-bar"}
            />
          );
        })}
        <text x={left} y={volumeTop - 7} className="chart-volume-label">거래량</text>

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
