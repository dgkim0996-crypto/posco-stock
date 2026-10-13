function fractionDigitsForStep(step, unit = 1, maximum = 4) {
  const normalized = Math.abs(step) / unit;
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized >= 1) return 0;
  return Math.min(maximum, Math.max(0, Math.ceil(-Math.log10(normalized)) + 1));
}

// 눈금 간격에 맞춰 큰 가격도 서로 구분될 만큼 충분한 소수 자릿수를 유지한다.
export function formatAxisPrice(value, asset, tickStep = 0) {
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
export function formatFullPrice(value, asset) {
  if (asset?.unit === "USD") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (asset?.unit === "PTS") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${Math.round(value).toLocaleString()}원`;
}

// 분봉은 시각, 일봉은 월/일 형식으로 하단 축을 표시한다.
export function formatTime(date, period) {
  if (period === "day") return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
