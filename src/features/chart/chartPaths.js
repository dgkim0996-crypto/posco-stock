export function linePath(series, coords, valueToY) {
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

export function bandAreaPath(upper, lower, coords, valueToY) {
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
