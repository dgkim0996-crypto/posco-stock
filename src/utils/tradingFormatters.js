

export function money(value) {
  const sign = value < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.round(value)).toLocaleString()}원`;
}

export function assetPrice(asset) {
  if (asset.unit === "PTS") {
    return asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (asset.unit === "USD") {
    return `$${asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(asset.price).toLocaleString()}원`;
}

export function signedPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
