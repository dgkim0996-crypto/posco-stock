import WebSocket, { WebSocketServer } from "ws";
import kisAuthService from "./kisAuth.service.js";
import marketDataService from "./marketData.service.js";
import { instruments } from "../data/instruments.data.js";

const domesticSymbols = new Set(instruments.filter((item) => item.currency === "KRW" && item.market !== "SIM").map((item) => item.symbol));
const clients = new Set();
const subscriptions = new Map();
const orderBooks = new Map();
let upstream = null;
let approvalKey = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let connectedAt = null;
let lastMessageAt = null;
let lastError = null;
let stopping = false;

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const upstreamUrl = () => process.env.KIS_ENV === "paper"
  ? "ws://ops.koreainvestment.com:31000" : "ws://ops.koreainvestment.com:21000";

const getApprovalKey = async () => {
  kisAuthService.validateConfig();
  const response = await fetch(`${kisAuthService.getBaseUrl()}/oauth2/Approval`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: process.env.KIS_APP_KEY, secretkey: process.env.KIS_APP_SECRET }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.approval_key) throw new Error(body.msg1 || body.error_description || `WebSocket 접속키 발급 실패 (${response.status})`);
  return body.approval_key;
};

const requestSubscription = (symbol, trType = "1") => {
  if (upstream?.readyState !== WebSocket.OPEN || !approvalKey) return;
  for (const trId of ["H0STCNT0", "H0STASP0"]) {
    upstream.send(JSON.stringify({
      header: { approval_key: approvalKey, custtype: "P", tr_type: trType, "content-type": "utf-8" },
      body: { input: { tr_id: trId, tr_key: symbol } },
    }));
  }
};

const broadcast = (payload, symbol = null) => {
  const encoded = JSON.stringify(payload);
  for (const client of clients) {
    if (client.socket.readyState === WebSocket.OPEN && (!symbol || client.symbols.has(symbol))) client.socket.send(encoded);
  }
};

const parseTrade = (raw) => {
  const fields = raw.split("^");
  const quote = {
    symbol: fields[0], price: number(fields[2]), changeAmount: number(fields[4]), change: number(fields[5]),
    open: number(fields[7]), high: number(fields[8]), low: number(fields[9]), volume: number(fields[13]),
    ask: number(fields[10]), bid: number(fields[11]), updatedAt: new Date().toISOString(),
  };
  return marketDataService.ingestRealtimeQuote(quote);
};

const parseOrderBook = (raw) => {
  const fields = raw.split("^");
  const asks = Array.from({ length: 10 }, (_, index) => ({ price: number(fields[3 + index]), quantity: number(fields[23 + index]) }));
  const bids = Array.from({ length: 10 }, (_, index) => ({ price: number(fields[13 + index]), quantity: number(fields[33 + index]) }));
  const book = { symbol: fields[0], asks, bids, totalAskQuantity: number(fields[43]), totalBidQuantity: number(fields[44]), updatedAt: new Date().toISOString() };
  orderBooks.set(book.symbol, book);
  return book;
};

const handleUpstreamMessage = (data) => {
  const message = data.toString();
  lastMessageAt = new Date().toISOString();
  if (message.startsWith("0|")) {
    const [, trId, countText, payload = ""] = message.split("|", 4);
    const count = Math.max(1, Number(countText) || 1);
    const fieldsPerTrade = 46;
    if (trId === "H0STCNT0") {
      const fields = payload.split("^");
      for (let index = 0; index < count; index += 1) {
        const quote = parseTrade(fields.slice(index * fieldsPerTrade, (index + 1) * fieldsPerTrade).join("^"));
        if (quote) broadcast({ type: "quote", data: quote }, quote.symbol);
      }
    } else if (trId === "H0STASP0") {
      const book = parseOrderBook(payload);
      if (book.symbol) broadcast({ type: "orderbook", data: book }, book.symbol);
    }
    return;
  }
  try {
    const parsed = JSON.parse(message);
    if (parsed?.header?.tr_id === "PINGPONG") upstream?.send(message);
    else if (parsed?.body?.rt_cd === "1") {
      lastError = { message: parsed.body.msg1 || "KIS 구독 실패", occurredAt: new Date().toISOString() };
      broadcast({ type: "subscription", data: { ok: false, trId: parsed?.header?.tr_id, symbol: parsed?.header?.tr_key, message: parsed.body.msg1 } }, parsed?.header?.tr_key);
    } else if (parsed?.body?.rt_cd === "0" && parsed?.header?.tr_id) {
      broadcast({ type: "subscription", data: { ok: true, trId: parsed.header.tr_id, symbol: parsed.header.tr_key, message: parsed.body.msg1 } }, parsed.header.tr_key);
    }
  } catch { /* 알 수 없는 KIS 프레임은 다음 정상 프레임을 계속 기다린다. */ }
};

const scheduleReconnect = () => {
  if (stopping || reconnectTimer || subscriptions.size === 0) return;
  const delay = Math.min(30_000, 1_000 * (2 ** reconnectAttempts));
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect().catch(() => undefined); }, delay);
};

const connect = async () => {
  if (stopping || subscriptions.size === 0 || upstream?.readyState === WebSocket.OPEN || upstream?.readyState === WebSocket.CONNECTING) return;
  try {
    approvalKey = await getApprovalKey();
    upstream = new WebSocket(upstreamUrl());
    upstream.on("open", () => {
      reconnectAttempts = 0; connectedAt = new Date().toISOString(); lastError = null;
      for (const symbol of subscriptions.keys()) requestSubscription(symbol);
      broadcast({ type: "status", data: getStatus() });
    });
    upstream.on("message", handleUpstreamMessage);
    upstream.on("error", (error) => { lastError = { message: error.message, occurredAt: new Date().toISOString() }; });
    upstream.on("close", () => { upstream = null; connectedAt = null; broadcast({ type: "status", data: getStatus() }); scheduleReconnect(); });
  } catch (error) {
    lastError = { message: error.message, occurredAt: new Date().toISOString() };
    broadcast({ type: "status", data: getStatus() }); scheduleReconnect();
  }
};

const addSubscription = (client, symbol) => {
  if (!domesticSymbols.has(symbol) || client.symbols.has(symbol)) return;
  client.symbols.add(symbol);
  const count = subscriptions.get(symbol) || 0;
  subscriptions.set(symbol, count + 1);
  if (count === 0) requestSubscription(symbol);
  const cachedBook = orderBooks.get(symbol);
  if (cachedBook) client.socket.send(JSON.stringify({ type: "orderbook", data: cachedBook }));
  connect().catch(() => undefined);
};
const removeSubscription = (client, symbol) => {
  if (!client.symbols.delete(symbol)) return;
  const next = Math.max(0, (subscriptions.get(symbol) || 1) - 1);
  if (next === 0) { subscriptions.delete(symbol); requestSubscription(symbol, "2"); } else subscriptions.set(symbol, next);
};

const getStatus = () => ({
  connected: upstream?.readyState === WebSocket.OPEN, environment: kisAuthService.getEnvironment(),
  subscribedSymbols: [...subscriptions.keys()], clientCount: clients.size, connectedAt, lastMessageAt, lastError,
  reconnectAttempts, reconnectScheduled: Boolean(reconnectTimer),
});

const attach = (server) => {
  const wss = new WebSocketServer({ server, path: "/ws/market" });
  wss.on("connection", (socket) => {
    const client = { socket, symbols: new Set() };
    clients.add(client);
    socket.send(JSON.stringify({ type: "status", data: getStatus() }));
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === "subscribe") addSubscription(client, String(message.symbol || "").trim());
        if (message.type === "unsubscribe") removeSubscription(client, String(message.symbol || "").trim());
      } catch { socket.send(JSON.stringify({ type: "error", error: "잘못된 WebSocket 요청입니다." })); }
    });
    socket.on("close", () => { for (const symbol of [...client.symbols]) removeSubscription(client, symbol); clients.delete(client); });
  });
  return wss;
};

const stop = () => {
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  upstream?.close();
};

export default { attach, getStatus, stop };
