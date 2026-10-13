import { INITIAL_MARKETS } from "../../src/data/markets.js";
import { estimateTradeTaxes } from "../../src/utils/tradeTaxes.js";

export const supabaseConfigurationError = null;
const session = { user: { id: "isolated-ui-fixture", email: "ui-test@example.test" }, access_token: "fixture-only" };
export const supabase = { auth: {
  getSession: async () => ({ data: { session } }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  signOut: async () => ({}),
} };
export const apiUrl = (path) => path;
export const websocketUrl = () => `ws://${window.location.host}/fixture-no-websocket`;
const today = new Date().toISOString();
let sequence = 1;
const state = {
  account: { accountNumber: "UI-TEST-0001", krwBalance: 10000000, usdBalance: 0 },
  holdings: [{ symbol: "005490", category: "stocks", quantity: 10, avgPrice: 300000 }],
  finance: Object.fromEntries(["credit", "margin", "lending", "collateral"].map((key) => [key, { active: false, limit: 0, debt: 0, locked: 0 }])),
  shortPositions: [], futuresPositions: [],
  orders: [{ id: "fixture-partial-cancelled", symbol: "005490", category: "stocks", side: "BUY", orderType: "LIMIT", quantity: 10, filledQuantity: 4, remainingQuantity: 0, cancelledQuantity: 6, limitPrice: 330000, executionPrice: 329000, feeAmount: 197.4, taxAmount: 0, status: "CANCELLED", createdAt: today, updatedAt: today }],
  pendingOrders: [],
};
const results = new Map();
const response = (body, status = 200) => new Response(JSON.stringify(structuredClone(body)), { status, headers: { "Content-Type": "application/json" } });

export async function apiFetch(path, options = {}) {
  const method = options.method || "GET";
  const body = JSON.parse(options.body || "{}");
  if (method === "GET") {
    if (path.endsWith("/state")) return response(state);
    if (path.endsWith("/risk")) return response({ status: "SAFE", liquidations: [] });
    return response({ items: [] });
  }
  if (body.clientOrderId && results.has(body.clientOrderId)) return response(results.get(body.clientOrderId));
  const asset = Object.values(INITIAL_MARKETS).flat().find((item) => item.symbol === body.symbol);
  if (path.endsWith("/pending-orders") && method === "POST") {
    const id = `fixture-${sequence++}`;
    const pending = { id, orderId: id, symbol: body.symbol, category: "stocks", side: body.side, quantity: body.quantity, limitPrice: body.limitPrice, createdAt: new Date().toISOString() };
    state.pendingOrders.unshift(pending);
    state.orders.unshift({ ...pending, orderType: "LIMIT", status: "PENDING", filledQuantity: 0, remainingQuantity: body.quantity, cancelledQuantity: 0 });
    results.set(body.clientOrderId, pending);
    return response(pending, 201);
  }
  if (path.includes("/pending-orders/")) {
    const id = path.split("/").at(-1);
    const pending = state.pendingOrders.find((item) => item.id === id);
    const order = state.orders.find((item) => item.id === id);
    if (!pending) return response({ error: "미체결 주문 없음" }, 404);
    if (method === "PATCH") {
      Object.assign(pending, { quantity: body.quantity, limitPrice: body.limitPrice });
      Object.assign(order, { quantity: body.quantity, remainingQuantity: body.quantity, limitPrice: body.limitPrice, updatedAt: new Date().toISOString() });
      return response(pending);
    }
    state.pendingOrders = state.pendingOrders.filter((item) => item.id !== id);
    Object.assign(order, { status: "CANCELLED", cancelledQuantity: order.remainingQuantity, remainingQuantity: 0, updatedAt: new Date().toISOString() });
    return response({ id, order });
  }
  if (path === "/api/orders" && asset) {
    const price = asset.price * (asset.unit === "USD" ? 1380 : 1);
    const charges = estimateTradeTaxes({ category: "stocks", asset, side: body.side, priceKrw: price, quantity: body.quantity });
    const id = `fixture-${sequence++}`;
    const order = { ...body, id, category: "stocks", quantity: body.quantity, filledQuantity: body.quantity, remainingQuantity: 0, status: "FILLED", executionPrice: price, price, feeAmount: charges.feeAmount, taxAmount: charges.immediateTaxAmount, createdAt: new Date().toISOString() };
    state.orders.unshift(order);
    state.account.krwBalance += charges.settlementAmount;
    let holding = state.holdings.find((item) => item.symbol === body.symbol);
    if (!holding) { holding = { symbol: body.symbol, category: "stocks", quantity: 0, avgPrice: price }; state.holdings.push(holding); }
    holding.quantity += (body.side === "BUY" ? 1 : -1) * body.quantity;
    const result = { account: state.account, order, holding };
    results.set(body.clientOrderId, structuredClone(result));
    return response(result, 201);
  }
  return response({ error: "이 동작은 격리된 UI 테스트에서 지원하지 않습니다." }, 400);
}
