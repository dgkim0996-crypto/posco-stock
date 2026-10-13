const FINAL_STATUSES = new Set(["FILLED", "CANCELLED", "REJECTED"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET = 9 * 60 * 60 * 1000;
const positiveNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};
const priceNumber = (value) => positiveNumber(value, null);
const timestamp = (value) => value ? new Date(value).getTime() : NaN;
const searchText = (value) => String(value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s/g, "");

/** Use linked order IDs only: two orders in the same symbol must remain separate. */
export function buildOrderRows(orders = [], pendingOrders = [], assets = []) {
  const assetMap = new Map(assets.map((asset) => [asset.symbol, asset]));
  const uniquePending = new Map(pendingOrders.map((pending) => [String(pending.id), pending]));
  const pendingByOrder = new Map();
  for (const pending of uniquePending.values()) {
    if (pending.orderId != null) pendingByOrder.set(String(pending.orderId), pending);
  }
  const uniqueOrders = new Map(orders.map((order) => [String(order.id), order]));
  const usedPending = new Set();
  const rows = [];

  for (const order of uniqueOrders.values()) {
    const pending = pendingByOrder.get(String(order.id)) || null;
    if (pending) usedPending.add(String(pending.id));
    const asset = assetMap.get(order.symbol);
    const quantity = positiveNumber(order.quantity);
    const filledQuantity = positiveNumber(order.filledQuantity, order.status === "FILLED" ? quantity : 0);
    const cancelledQuantity = positiveNumber(order.cancelledQuantity, order.status === "CANCELLED" ? Math.max(0, quantity - filledQuantity) : 0);
    const remainingQuantity = FINAL_STATUSES.has(order.status) ? 0
      : positiveNumber(order.remainingQuantity, pending ? positiveNumber(pending.quantity) : Math.max(0, quantity - filledQuantity - cancelledQuantity));
    rows.push({
      ...order,
      key: `order:${order.id}`,
      assetId: asset?.id || order.symbol,
      name: asset?.name || pending?.name || order.name || order.symbol,
      market: asset?.market || "",
      quantity, filledQuantity, remainingQuantity, cancelledQuantity,
      limitPrice: priceNumber(order.limitPrice),
      executionPrice: filledQuantity > 0 ? priceNumber(order.executionPrice) : null,
      priceCurrency: "KRW",
      feeAmount: positiveNumber(order.feeAmount),
      taxAmount: positiveNumber(order.taxAmount),
      pendingOrder: !FINAL_STATUSES.has(order.status) && remainingQuantity > 0 ? pending : null,
    });
  }

  for (const pending of uniquePending.values()) {
    if (usedPending.has(String(pending.id))) continue;
    const asset = assetMap.get(pending.symbol);
    const quantity = positiveNumber(pending.quantity);
    rows.push({
      ...pending,
      id: pending.orderId ?? pending.id,
      key: `pending:${pending.id}`,
      assetId: asset?.id || pending.assetId || pending.symbol,
      name: asset?.name || pending.name || pending.symbol,
      market: asset?.market || "",
      orderType: "LIMIT", status: "OPEN",
      // A pending-only record contains the remaining quantity, not the original quantity.
      quantity: null, filledQuantity: null, remainingQuantity: quantity, cancelledQuantity: null,
      limitPrice: priceNumber(pending.limitPrice), executionPrice: null,
      priceCurrency: asset?.unit === "USD" ? "USD" : "KRW",
      feeAmount: null, taxAmount: null,
      pendingOrder: quantity > 0 ? pending : null,
      incomplete: true,
    });
  }

  return rows.sort((a, b) => (timestamp(b.createdAt) || 0) - (timestamp(a.createdAt) || 0)
    || String(b.id).localeCompare(String(a.id), "en", { numeric: true }));
}

export function kstDateKey(value = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() + KST_OFFSET).toISOString().slice(0, 10);
}

export function isOrderDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isFinite(date.getTime()) && kstDateKey(date) === value;
}

export function orderStatus(row) {
  if (row.status === "REJECTED") return { label: "거부", tone: "rejected" };
  if (row.status === "CANCELLED") return { label: row.filledQuantity > 0 ? "부분체결 · 잔량취소" : "취소", tone: "cancelled" };
  if (row.remainingQuantity > 0) return { label: row.filledQuantity > 0 ? "부분체결" : "미체결", tone: "pending" };
  if (row.filledQuantity > 0 || row.status === "FILLED") return { label: "체결완료", tone: "filled" };
  return { label: "확인 중", tone: "unknown" };
}

export function orderMatchesStatus(row, status = "all") {
  if (status === "pending") return row.remainingQuantity > 0 && !FINAL_STATUSES.has(row.status);
  if (status === "filled") return row.filledQuantity > 0;
  if (status === "cancelled") return row.status === "CANCELLED" || row.cancelledQuantity > 0;
  return true;
}

export function filterOrderRows(rows, { keyword = "", side = "all", period = "all", startDate = "", endDate = "", selectedOnly = false, selectedSymbol, status = "all", now = Date.now() } = {}) {
  const search = searchText(keyword);
  const today = kstDateKey(now);
  const custom = period === "custom";
  // Incomplete and reversed ranges must never silently broaden a financial export.
  if (custom && (!isOrderDateKey(startDate) || !isOrderDateKey(endDate) || startDate > endDate)) return [];
  const firstDay = custom ? startDate : period === "today" ? today : kstDateKey(new Date(now).getTime() - (period === "30days" ? 29 : 6) * DAY_MS);
  const lastDay = custom ? endDate : today;
  return rows.filter((row) => {
    if (search && ![row.name, row.symbol, row.id, row.pendingOrder?.id].some((value) => searchText(value).includes(search))) return false;
    if (side !== "all" && row.side !== side) return false;
    if (selectedOnly && row.symbol !== selectedSymbol) return false;
    if (period !== "all") {
      const day = row.createdAt ? kstDateKey(row.createdAt) : "";
      if (!day || day < firstDay || day > lastDay) return false;
    }
    return orderMatchesStatus(row, status);
  });
}

export function summarizeOrderRows(rows) {
  return rows.reduce((summary, row) => {
    summary.all += 1;
    if (orderMatchesStatus(row, "pending")) summary.pending += 1;
    if (orderMatchesStatus(row, "filled")) summary.filled += 1;
    if (orderMatchesStatus(row, "cancelled")) summary.cancelled += 1;
    if (row.filledQuantity > 0 && Number.isFinite(row.executionPrice)) {
      if (row.side === "BUY") summary.buyAmount += row.filledQuantity * row.executionPrice;
      if (row.side === "SELL") summary.sellAmount += row.filledQuantity * row.executionPrice;
    }
    summary.costAmount += (row.feeAmount || 0) + (row.taxAmount || 0);
    return summary;
  }, { all: 0, pending: 0, filled: 0, cancelled: 0, buyAmount: 0, sellAmount: 0, costAmount: 0 });
}

export function formatOrderDateTime(value) {
  const time = timestamp(value);
  if (!Number.isFinite(time)) return { date: "—", time: "—", full: "—" };
  const date = kstDateKey(time);
  const clock = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(time);
  return { date, time: clock, full: `${date} ${clock} KST` };
}

const csvCell = (value) => {
  let text = String(value ?? "");
  // Quoting alone does not stop spreadsheet formula execution.
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export function orderRowsToCsv(rows) {
  const headers = ["주문번호", "주문일시(KST)", "최근변경일시(KST)", "종목코드", "종목명", "매매구분", "주문유형", "상태", "주문수량", "체결수량", "미체결수량", "취소수량", "주문가격", "주문가격통화", "평균체결가(KRW)", "수수료(KRW)", "세금(KRW)", "결제예정일", "비고"];
  const records = rows.map((row) => [row.id, formatOrderDateTime(row.createdAt).full, formatOrderDateTime(row.updatedAt || row.createdAt).full,
    // CSV quotes do not prevent Excel from dropping the zero in a code like 005490.
    /^0\d+$/.test(String(row.symbol)) ? `'${row.symbol}` : row.symbol, row.name, row.side === "BUY" ? "매수" : row.side === "SELL" ? "매도" : row.side,
    row.orderType === "MARKET" ? "시장가" : "지정가", orderStatus(row).label, row.quantity, row.filledQuantity,
    row.remainingQuantity, row.cancelledQuantity, row.orderType === "MARKET" ? "" : row.limitPrice, row.priceCurrency,
    row.executionPrice, row.feeAmount, row.taxAmount, row.settlementDate || "", row.incomplete ? "미체결 잔량만 조회됨" : ""]);
  return `\uFEFF${[headers, ...records].map((record) => record.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
