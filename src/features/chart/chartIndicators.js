export function movingAverage(values, period) {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= period) sum -= values[index - period];
    return index >= period - 1 ? sum / period : null;
  });
}

export function exponentialMovingAverage(values, period) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  let previous = values[0];
  return values.map((value, index) => {
    if (index === 0) return previous;
    previous = value * multiplier + previous * (1 - multiplier);
    return previous;
  });
}

export function bollingerBands(values, period = 20, multiplier = 2) {
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

export function relativeStrengthIndex(values, period = 14) {
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

export function movingAverageConvergenceDivergence(values) {
  const fast = exponentialMovingAverage(values, 12);
  const slow = exponentialMovingAverage(values, 26);
  const macd = values.map((_, index) => fast[index] - slow[index]);
  const signal = exponentialMovingAverage(macd, 9);
  const histogram = macd.map((value, index) => value - signal[index]);
  return { macd, signal, histogram };
}

// Calculate against the complete history so panning cannot restart indicator windows.
export function calculateIndicators(allCandles) {
  const closes = allCandles.map((item) => item.close);
  return {
    ma5: movingAverage(closes, 5),
    ma20: movingAverage(closes, 20),
    bollinger: bollingerBands(closes),
    rsi: relativeStrengthIndex(closes),
    macd: movingAverageConvergenceDivergence(closes),
  };
}
