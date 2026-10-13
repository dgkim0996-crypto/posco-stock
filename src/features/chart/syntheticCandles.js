

export function seedChartValues(price, count = 72) {
  const start = price * (1 + (Math.random() - 0.5) * 0.018);
  const values = [Math.max(0.0001, start)];
  for (let i = 1; i < count - 1; i += 1) {
    const prev = values[i - 1];
    const drift = (price - prev) * 0.055;
    const noise = price * (Math.random() - 0.5) * 0.0045;
    values.push(Math.max(0.0001, prev + drift + noise));
  }
  values.push(price);
  return values;
}

export function buildSyntheticCandles(leftCandles, rightCandles, currentPrice, leverage = 10) {
  const left = Array.isArray(leftCandles) ? leftCandles : [];
  const right = Array.isArray(rightCandles) ? rightCandles : [];
  const rightByTime = new Map(right.map((item) => [item.time, item]));
  let pairs = left.flatMap((item) => rightByTime.has(item.time) ? [[item, rightByTime.get(item.time)]] : []);

  // 제공처가 시각을 조금 다르게 반환한 경우에는 최신 봉끼리 순서대로 결합한다.
  if (pairs.length < 2) {
    const count = Math.min(left.length, right.length);
    pairs = Array.from({ length: count }, (_, index) => [left[left.length - count + index], right[right.length - count + index]]);
  }
  if (pairs.length < 2) return [];

  let previousLeft = Number(pairs[0][0].open) || Number(pairs[0][0].close);
  let previousRight = Number(pairs[0][1].open) || Number(pairs[0][1].close);
  let previousSynthetic = 10_000;
  const factor = (leftValue, rightValue) => Math.max(0.01, 1 + leverage * (
    ((Number(leftValue) / previousLeft) - 1 + (Number(rightValue) / previousRight) - 1) / 2
  ));

  const candles = pairs.map(([leftItem, rightItem]) => {
    const open = previousSynthetic * factor(leftItem.open, rightItem.open);
    const close = previousSynthetic * factor(leftItem.close, rightItem.close);
    const rawHigh = previousSynthetic * factor(leftItem.high, rightItem.high);
    const rawLow = previousSynthetic * factor(leftItem.low, rightItem.low);
    const item = {
      time: leftItem.time,
      open,
      high: Math.max(open, close, rawHigh, rawLow),
      low: Math.min(open, close, rawHigh, rawLow),
      close,
      volume: Math.round(((Number(leftItem.volume) || 0) + (Number(rightItem.volume) || 0)) / 2),
    };
    previousLeft = Number(leftItem.close) || previousLeft;
    previousRight = Number(rightItem.close) || previousRight;
    previousSynthetic = Math.max(100, close);
    return item;
  });

  const lastClose = candles.at(-1)?.close;
  const scale = Number.isFinite(currentPrice) && Number.isFinite(lastClose) && lastClose > 0 ? currentPrice / lastClose : 1;
  return candles.map((item) => ({
    ...item,
    open: Math.max(100, item.open * scale),
    high: Math.max(100, item.high * scale),
    low: Math.max(100, item.low * scale),
    close: Math.max(100, item.close * scale),
  }));
}
