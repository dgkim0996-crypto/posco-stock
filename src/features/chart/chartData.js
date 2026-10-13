import { PERIOD_MS, VOLUME_HEIGHTS, DEFAULT_VOLUME_LEVEL, INDICATOR_PANEL_HEIGHT, INDICATOR_PANEL_GAP } from "./chartConstants.js";

// Normalize provider OHLCV or construct flat candles from simulated prices.
export function normalizeCandles({ values, candles, period }, now = Date.now()) {
  const interval = PERIOD_MS[period] || PERIOD_MS["1m"];
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
}

// Build visible geometry from the viewport without changing the source candle history.
export function prepareChart({ allCandles, viewRange, priceScale, volumeLevel, averagePrice, tradeMarkers, period, indicatorData, indicators }) {
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
  const volumeHeight = VOLUME_HEIGHTS[volumeLevel] || VOLUME_HEIGHTS[DEFAULT_VOLUME_LEVEL];
  const indicatorPanels = {};
  let contentBottom = priceBottom;
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

  return { normalized, clean, w, h, left, right, top, priceBottom, volumeHeight, contentBottom, indicatorPanels, indicatorSeries, axisBottom, plotW, plotH, min, max, range, coords, volumes, maxVolume, times, averageY, averagePriceValue, tradeMarkerCoords };
}
