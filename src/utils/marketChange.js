// 시세 제공처의 전일 대비 금액을 우선 사용하고, 없으면 현재가와 등락률로 전일 종가를 역산한다.
export function getChangeAmount(asset) {
  const price = Number(asset?.price);
  const rate = Number(asset?.change);
  const hasProvidedAmount = asset?.changeAmount !== null && asset?.changeAmount !== undefined && asset?.changeAmount !== "";
  const provided = Number(asset?.changeAmount);

  if (hasProvidedAmount && Number.isFinite(provided)) {
    if (rate > 0) return Math.abs(provided);
    if (rate < 0) return -Math.abs(provided);
    return provided;
  }
  if (!Number.isFinite(price) || !Number.isFinite(rate) || rate <= -100) return 0;

  const previousClose = price / (1 + rate / 100);
  return price - previousClose;
}

export function formatChangeAmount(asset) {
  const amount = getChangeAmount(asset);
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);

  if (asset?.unit === "USD") {
    return `${sign}$${absolute.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (asset?.unit === "PTS") {
    return `${sign}${absolute.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}pt`;
  }
  return `${sign}${Math.round(absolute).toLocaleString()}원`;
}
