import React, { useEffect, useId, useMemo, useRef, useState } from "react";

// SVG 캔들/거래량 차트. 데이터 정규화 → 좌표 계산 → 확대·이동·툴팁 렌더링 순으로 동작한다.

const PERIOD_MS = {
  "1m": 60_000,
  "5m": 300_000,
  "30m": 1_800_000,
  "60m": 3_600_000,
  day: 86_400_000,
};
const MAX_VISIBLE_CANDLES = 60;
const PRICE_TICK_COUNT = 8;
const MIN_PRICE_SCALE = 0.35;
const MAX_PRICE_SCALE = 8;
const VOLUME_HEIGHTS = [48, 72, 96, 120];
const DEFAULT_VOLUME_LEVEL = 1;
const INDICATOR_PANEL_HEIGHT = 76;
const INDICATOR_PANEL_GAP = 10;

function movingAverage(values, period) {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period];
    return index >= period - 1 ? sum / period : null;
  });
}

function exponentialMovingAverage(values, period) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  let previous = values[0];
  return values.map((value, index) => {
    if (index === 0) return previous;
    previous = value * multiplier + previous * (1 - multiplier);
    return previous;
  });
}

function bollingerBands(values, period = 20, multiplier = 2) {
  const middle = movingAverage(values, period);
  const upper = [];
  const lower = [];

  values.forEach((value, index) => {
    if (index < period - 1) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const window = values.slice(index - period + 1, index + 1);
    const average = middle[index];
    const variance = window.reduce((sum, item) => sum + (item - average) ** 2, 0) / period;
    const deviation = Math.sqrt(variance) * multiplier;
    upper.push(average + deviation);
    lower.push(average - deviation);
  });

  return { middle, upper, lower };
}

function relativeStrengthIndex(values, period = 14) {
  const result = Array(values.length).fill(null);
  if (values.length <= period) return result;

  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  result[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }

  return result;
}

function movingAverageConvergenceDivergence(values) {
  const fast = exponentialMovingAverage(values, 12);
  const slow = exponentialMovingAverage(values, 26);
  const macd = values.map((_, index) => fast[index] - slow[index]);
  const signal = exponentialMovingAverage(macd, 9);
  const histogram = macd.map((value, index) => value - signal[index]);
  return { macd, signal, histogram };
}

function linePath(series, coords, valueToY) {
  let drawing = false;
  return series.reduce((path, value, index) => {
    if (!Number.isFinite(value)) {
      drawing = false;
      return path;
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${path}${command}${coords[index].x.toFixed(2)},${valueToY(value).toFixed(2)} `;
  }, "").trim();
}

function bandAreaPath(upper, lower, coords, valueToY) {
  const points = upper.map((value, index) => ({ value, index })).filter(({ value }) => Number.isFinite(value));
  if (points.length < 2) return "";
  const start = points[0].index;
  const end = points.at(-1).index;
  const upperPath = Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
    .filter((index) => Number.isFinite(upper[index]) && Number.isFinite(lower[index]))
    .map((index) => `${coords[index].x.toFixed(2)},${valueToY(upper[index]).toFixed(2)}`);
  const lowerPath = Array.from({ length: end - start + 1 }, (_, offset) => end - offset)
    .filter((index) => Number.isFinite(upper[index]) && Number.isFinite(lower[index]))
    .map((index) => `${coords[index].x.toFixed(2)},${valueToY(lower[index]).toFixed(2)}`);
  return upperPath.length > 1 ? `M${upperPath.join(" L")} L${lowerPath.join(" L")} Z` : "";
}

function fractionDigitsForStep(step, unit = 1, maximum = 4) {
  const normalized = Math.abs(step) / unit;
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized >= 1) return 0;
  return Math.min(maximum, Math.max(0, Math.ceil(-Math.log10(normalized)) + 1));
}

// 눈금 간격에 맞춰 큰 가격도 서로 구분될 만큼 충분한 소수 자릿수를 유지한다.
function formatAxisPrice(value, asset, tickStep = 0) {
  if (!Number.isFinite(value)) return "-";
  if (asset?.unit === "USD") {
    const maximumFractionDigits = fractionDigitsForStep(tickStep, 1, 4);
    return `$${value.toLocaleString(undefined, { maximumFractionDigits })}`;
  }
  if (asset?.unit === "PTS") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (Math.abs(value) >= 100000000) {
    const digits = fractionDigitsForStep(tickStep, 100000000, 4);
    return `${(value / 100000000).toFixed(digits)}억`;
  }
  if (Math.abs(value) >= 10000) {
    const digits = fractionDigitsForStep(tickStep, 1000, 3);
    return `${(value / 1000).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}천`;
  }
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

export default function Sparkline({ values, candles, asset, period = "1m", averagePrice = null, tradeMarkers = [], indicators = [] }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const [viewRange, setViewRange] = useState({ start: 0, end: 0 });
  const [priceScale, setPriceScale] = useState(1);
  const [volumeLevel, setVolumeLevel] = useState(DEFAULT_VOLUME_LEVEL);
  const priceClipId = `chart-price-${useId().replaceAll(":", "")}`;
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const indicatorSignature = [...indicators].sort().join(",");

  // 실제 OHLCV가 없으면 모의상품의 가격 배열을 가상 봉으로 변환한다.
  const allCandles = useMemo(() => {
    const interval = PERIOD_MS[period] || PERIOD_MS["1m"];
    const now = Date.now();
    return Array.isArray(candles) && candles.length
      ? candles
          .filter((item) => item && Number.isFinite(Number(item.close)) && Number(item.close) > 0)
          .map((item) => {
            const close = Number(item.close);
            const open = Number(item.open) > 0 ? Number(item.open) : close;
            const reportedHigh = Number(item.high) > 0 ? Number(item.high) : Math.max(open, close);
            const reportedLow = Number(item.low) > 0 ? Number(item.low) : Math.min(open, close);
            return {
              ...item,
              time: new Date(item.time),
              open,
              high: Math.max(reportedHigh, open, close),
              low: Math.min(reportedLow, open, close),
              close,
            };
          })
      : (values || []).filter(Number.isFinite).map((value, index, list) => ({
          time: new Date(now - (list.length - 1 - index) * interval),
          open: value,
          high: value,
          low: value,
          close: value,
          volume: 0,
        }));
  }, [values, candles, period]);

  // 전체 봉 기준으로 지표를 먼저 계산해 화면을 이동해도 지표 시작값이 흔들리지 않게 한다.
  const indicatorData = useMemo(() => {
    const closes = allCandles.map((item) => item.close);
    return {
      ma5: movingAverage(closes, 5),
      ma20: movingAverage(closes, 20),
      bollinger: bollingerBands(closes),
      rsi: relativeStrengthIndex(closes),
      macd: movingAverageConvergenceDivergence(closes),
    };
  }, [allCandles]);

  // 종목이나 기간이 바뀌면 기간별 기본 봉 개수로 화면 범위를 초기화한다.
  useEffect(() => {
    const end = allCandles.length;
    const initialCount = Math.min(MAX_VISIBLE_CANDLES, end);
    setViewRange({ start: Math.max(0, end - initialCount), end });
    setHoverIndex(null);
  }, [asset?.id, period, allCandles.length]);

  // 다른 종목이나 기간으로 이동하면 세로축을 해당 데이터의 자동 범위로 되돌린다.
  useEffect(() => {
    setPriceScale(1);
  }, [asset?.id, period]);

  // 표시 범위의 가격/거래량 최댓값과 각 봉의 SVG 좌표를 미리 계산한다.
  const prepared = useMemo(() => {
    const normalized = allCandles.slice(viewRange.start, viewRange.end || allCandles.length);
    const clean = normalized.map((item) => item.close);
    if (clean.length < 2) return null;

    const enabled = new Set(indicators);
    const sliceEnd = viewRange.end || allCandles.length;
    const indicatorSeries = {
      ma5: indicatorData.ma5.slice(viewRange.start, sliceEnd),
      ma20: indicatorData.ma20.slice(viewRange.start, sliceEnd),
      bollinger: {
        middle: indicatorData.bollinger.middle.slice(viewRange.start, sliceEnd),
        upper: indicatorData.bollinger.upper.slice(viewRange.start, sliceEnd),
        lower: indicatorData.bollinger.lower.slice(viewRange.start, sliceEnd),
      },
      rsi: indicatorData.rsi.slice(viewRange.start, sliceEnd),
      macd: {
        macd: indicatorData.macd.macd.slice(viewRange.start, sliceEnd),
        signal: indicatorData.macd.signal.slice(viewRange.start, sliceEnd),
        histogram: indicatorData.macd.histogram.slice(viewRange.start, sliceEnd),
      },
    };

    const w = 920;
    const left = 18;
    const right = 92;
    const top = 20;
    const priceBottom = 270;
    const volumeTop = 292;
    const volumeHeight = VOLUME_HEIGHTS[volumeLevel] || VOLUME_HEIGHTS[DEFAULT_VOLUME_LEVEL];
    const volumeBottom = volumeTop + volumeHeight;
    const indicatorPanels = {};
    let contentBottom = volumeBottom;
    ["rsi", "macd"].forEach((key) => {
      if (!enabled.has(key)) return;
      const panelTop = contentBottom + INDICATOR_PANEL_GAP;
      indicatorPanels[key] = { top: panelTop, bottom: panelTop + INDICATOR_PANEL_HEIGHT };
      contentBottom = panelTop + INDICATOR_PANEL_HEIGHT;
    });
    const axisBottom = contentBottom + 22;
    const h = axisBottom + 12;
    const plotW = w - left - right;
    const plotH = priceBottom - top;
    const interval = PERIOD_MS[period] || PERIOD_MS["1m"];
    const firstVisibleTime = normalized[0].time.getTime();
    const lastVisibleTime = normalized.at(-1).time.getTime();
    const visibleTradeMarkers = tradeMarkers.filter((marker) => {
      const markerTime = Number(marker?.time);
      return Number.isFinite(markerTime)
        && markerTime >= firstVisibleTime - interval
        && markerTime <= lastVisibleTime + interval * 2
        && Number.isFinite(Number(marker.price))
        && Number(marker.price) > 0;
    });
    const averagePriceValue = Number(averagePrice);
    const guidePrices = [
      ...(Number.isFinite(averagePriceValue) && averagePriceValue > 0 ? [averagePriceValue] : []),
      ...visibleTradeMarkers.map((marker) => Number(marker.price)),
      ...(enabled.has("ma5") ? indicatorSeries.ma5.filter(Number.isFinite) : []),
      ...(enabled.has("ma20") ? indicatorSeries.ma20.filter(Number.isFinite) : []),
      ...(enabled.has("bollinger") ? [
        ...indicatorSeries.bollinger.upper.filter(Number.isFinite),
        ...indicatorSeries.bollinger.lower.filter(Number.isFinite),
      ] : []),
    ];

    const rawMin = Math.min(...normalized.map((item) => item.low), ...guidePrices);
    const rawMax = Math.max(...normalized.map((item) => item.high), ...guidePrices);
    const rawRange = rawMax - rawMin || Math.abs(rawMax || 1) * 0.01 || 1;
    const autoRange = rawRange * 1.12;
    const center = (rawMin + rawMax) / 2;
    const range = Math.max(autoRange * priceScale, Number.EPSILON);
    const min = center - range / 2;
    const max = center + range / 2;

    const coords = clean.map((value, index) => ({
      value,
      x: left + (index / (clean.length - 1)) * plotW,
      y: top + ((max - value) / range) * plotH,
    }));

    const volumes = normalized.map((item) => Number(item.volume) || 0);
    const maxVolume = Math.max(...volumes, 1);
    const times = normalized.map((item) => item.time);
    const averageY = Number.isFinite(averagePriceValue) && averagePriceValue > 0
      ? top + ((max - averagePriceValue) / range) * plotH
      : null;
    const tradeMarkerCoords = visibleTradeMarkers.map((marker) => {
      const nearestIndex = times.reduce((closest, time, index) => (
        Math.abs(time.getTime() - marker.time) < Math.abs(times[closest].getTime() - marker.time) ? index : closest
      ), 0);
      return {
        ...marker,
        x: coords[nearestIndex].x,
        y: top + ((max - Number(marker.price)) / range) * plotH,
      };
    });

    return { normalized, clean, w, h, left, right, top, priceBottom, volumeTop, volumeBottom, volumeHeight, contentBottom, indicatorPanels, indicatorSeries, axisBottom, plotW, plotH, min, max, range, coords, volumes, maxVolume, times, averageY, averagePriceValue, tradeMarkerCoords };
  }, [allCandles, viewRange, priceScale, volumeLevel, averagePrice, tradeMarkers, period, indicatorData, indicatorSignature]);

  if (!prepared) {
    return <div className="chart-empty">시세 데이터를 수신하고 있습니다...</div>;
  }

  const { normalized, clean, w, h, left, top, priceBottom, volumeTop, volumeBottom, volumeHeight, contentBottom, indicatorPanels, indicatorSeries, axisBottom, plotW, min, max, range, coords, volumes, maxVolume, times, averageY, averagePriceValue, tradeMarkerCoords } = prepared;
  const enabledIndicators = new Set(indicators);
  const up = clean.at(-1) >= clean[0];
  const priceTickStep = range / (PRICE_TICK_COUNT - 1);
  const yTicks = Array.from({ length: PRICE_TICK_COUNT }, (_, i) => max - priceTickStep * i);
  const xTickIndexes = Array.from(new Set([0, Math.round((clean.length - 1) * 0.25), Math.round((clean.length - 1) * 0.5), Math.round((clean.length - 1) * 0.75), clean.length - 1]));
  const active = hoverIndex == null ? clean.length - 1 : Math.min(hoverIndex, clean.length - 1);
  const activePoint = coords[active];
  const activeTime = times[active];
  const priceToY = (value) => top + ((max - value) / range) * (priceBottom - top);
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

  // 포인터 툴팁을 이동하고 드래그 중에는 차트 이동 또는 시간축 확대를 수행한다.
  function handlePointerMove(event) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (dragRef.current) {
      const baseCount = dragRef.current.end - dragRef.current.start;
      if (dragRef.current.mode === "price-scale") {
        const delta = event.clientY - dragRef.current.y;
        const nextScale = dragRef.current.priceScale * Math.exp(delta / 180);
        setPriceScale(Math.max(MIN_PRICE_SCALE, Math.min(MAX_PRICE_SCALE, nextScale)));
      } else if (dragRef.current.mode === "time-scale") {
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

  // 본문/시간축 더블클릭은 기간을, 우측 가격축 더블클릭은 세로 자동 범위를 복원한다.
  function resetRange(event) {
    const rect = svgRef.current?.getBoundingClientRect();
    const svgX = rect ? ((event.clientX - rect.left) / rect.width) * prepared.w : 0;
    if (svgX > left + plotW) {
      setPriceScale(1);
      return;
    }
    setViewRange({ start: Math.max(0, allCandles.length - MAX_VISIBLE_CANDLES), end: allCandles.length });
    setPriceScale(1);
    setHoverIndex(null);
  }

  return (
    <div
      className="market-chart-wrap"
      style={{
        "--chart-height": `${h}px`,
        "--volume-control-offset": `${volumeTop + 4 - h / 2}px`,
      }}
    >
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
          const svgX = ((event.clientX - rect.left) / rect.width) * w;
          const svgY = ((event.clientY - rect.top) / rect.height) * h;
          dragRef.current = {
            mode: svgX > left + plotW && svgY <= priceBottom ? "price-scale" : svgY >= axisBottom - 18 ? "time-scale" : "pan",
            x: event.clientX,
            y: event.clientY,
            start: viewRange.start,
            end: viewRange.end,
            priceScale,
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
          <clipPath id={priceClipId}>
            <rect x={left} y={top} width={plotW} height={priceBottom - top} />
          </clipPath>
        </defs>

        <rect
          x={left}
          y={volumeTop}
          width={plotW}
          height={volumeHeight}
          className="chart-volume-background"
        />
        <line x1={left} y1={volumeTop} x2={left + plotW} y2={volumeTop} className="chart-volume-divider" />

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
              <line x1={x} y1={top} x2={x} y2={contentBottom} className="grid-line chart-grid-vertical" />
              <text x={x} y={axisBottom} textAnchor={index === 0 ? "start" : index === clean.length - 1 ? "end" : "middle"} className="chart-axis-text chart-time-text">
                {formatTime(times[index], period)}
              </text>
            </g>
          );
        })}


        {volumes.map((volume, index) => {
          const barTop = volumeTop + 18;
          const barBottom = volumeBottom - 4;
          const barHeight = Math.max(2, (volume / maxVolume) * (barBottom - barTop));
          const rising = index === 0 || clean[index] >= clean[index - 1];
          return (
            <rect
              key={`v-${index}`}
              x={coords[index].x - Math.max(0.4, plotW / clean.length / 3)}
              y={barBottom - barHeight}
              width={Math.max(0.8, plotW / clean.length / 1.8)}
              height={barHeight}
              rx="1"
              className={rising ? "volume-bar up-bar" : "volume-bar down-bar"}
            />
          );
        })}
        <text x={left + 5} y={volumeTop + 13} className="chart-volume-label">거래량</text>

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

        {Number.isFinite(averageY) && (
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
      </svg>

      <div
        className="chart-volume-controls"
        aria-label="거래량 차트 크기 조절"
      >
        <span>거래량 크기</span>
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
