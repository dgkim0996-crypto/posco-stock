import WebSocket, { WebSocketServer } from "ws";
import kisAuthService from "./kisAuth.service.js";
import marketDataService from "./marketData.service.js";
import { instruments } from "../data/instruments.data.js";

// 브라우저 /ws/market 연결과 KIS 실시간 WebSocket 하나를 중계한다.
// 브라우저 구독을 종목별로 합산해 KIS에는 종목당 한 번만 등록하고, 수신한 체결·호가를 구독자에게만 전달한다.

const domesticSymbols = new Set(instruments.filter((item) => item.currency === "KRW" && item.market !== "SIM").map((item) => item.symbol));
// 느린 브라우저의 송신 버퍼가 계속 쌓이면 서버 메모리를 지키기 위해 연결을 정리한다.
const MAX_BUFFERED_BYTES = 1_000_000;

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const defaultUpstreamUrl = () => process.env.KIS_ENV === "paper"
  ? "ws://ops.koreainvestment.com:31000" : "ws://ops.koreainvestment.com:21000";

const fetchApprovalKey = async () => {
  kisAuthService.validateConfig();
  const response = await fetch(`${kisAuthService.getBaseUrl()}/oauth2/Approval`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: process.env.KIS_APP_KEY, secretkey: process.env.KIS_APP_SECRET }),
    signal: AbortSignal.timeout(Number(process.env.KIS_REQUEST_TIMEOUT_MS) || 10_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.approval_key) throw new Error(body.msg1 || body.error_description || `WebSocket 접속키 발급 실패 (${response.status})`);
  return body.approval_key;
};

const parseTrade = (raw) => {
  const fields = raw.split("^");
  return {
    symbol: fields[0], price: number(fields[2]), changeAmount: number(fields[4]), change: number(fields[5]),
    open: number(fields[7]), high: number(fields[8]), low: number(fields[9]), volume: number(fields[13]),
    ask: number(fields[10]), bid: number(fields[11]), updatedAt: new Date().toISOString(),
  };
};

const parseOrderBook = (raw) => {
  const fields = raw.split("^");
  const asks = Array.from({ length: 10 }, (_, index) => ({ price: number(fields[3 + index]), quantity: number(fields[23 + index]) }));
  const bids = Array.from({ length: 10 }, (_, index) => ({ price: number(fields[13 + index]), quantity: number(fields[33 + index]) }));
  return { symbol: fields[0], asks, bids, totalAskQuantity: number(fields[43]), totalBidQuantity: number(fields[44]), updatedAt: new Date().toISOString() };
};

// 테스트에서 KIS 접속키·주소와 한도를 바꿔 끼울 수 있도록 상태를 인스턴스 안에 둔다.
export function createMarketWebSocketService({
  getApprovalKey = fetchApprovalKey,
  upstreamUrl = defaultUpstreamUrl,
  isSupportedSymbol = (symbol) => domesticSymbols.has(symbol),
  ingestQuote = (quote) => marketDataService.ingestRealtimeQuote(quote),
  // KIS는 연결당 실시간 등록 수가 제한되며 종목마다 체결·호가 2건을 등록한다.
  maxSymbolsPerClient = positiveInteger(process.env.WS_MAX_SYMBOLS_PER_CLIENT, 3),
  maxTotalSymbols = positiveInteger(process.env.WS_MAX_TOTAL_SYMBOLS, 20),
  maxClients = positiveInteger(process.env.WS_MAX_CLIENTS, 500),
  // 브라우저는 짧은 구독/해지 JSON만 보내므로 큰 프레임은 받지 않는다.
  maxPayload = 1_024,
  heartbeatMs = 30_000,
  messageWindowMs = 10_000,
  maxMessagesPerWindow = 40,
} = {}) {
  const clients = new Set();
  const subscriptions = new Map();
  const confirmedSubscriptions = new Map();
  const orderBooks = new Map();
  let wss = null;
  let heartbeatTimer = null;
  let upstream = null;
  // 접속키 발급을 기다리는 동안 들어온 구독도 같은 연결 시도를 공유한다.
  let connecting = null;
  let approvalKey = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let connectedAt = null;
  let lastMessageAt = null;
  let lastError = null;
  let stopping = false;

  const send = (socket, payload) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate();
      return;
    }
    socket.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  };

  const getStatus = () => ({
    connected: upstream?.readyState === WebSocket.OPEN, environment: kisAuthService.getEnvironment(),
    subscribedSymbols: [...subscriptions.keys()], clientCount: clients.size, connectedAt, lastMessageAt, lastError,
    reconnectAttempts, reconnectScheduled: Boolean(reconnectTimer),
  });

  const broadcast = (payload, symbol = null) => {
    const encoded = JSON.stringify(payload);
    for (const client of clients) {
      if (!symbol || client.symbols.has(symbol)) send(client.socket, encoded);
    }
  };

  const requestSubscription = (symbol, trType = "1") => {
    const socket = upstream;
    if (socket?.readyState !== WebSocket.OPEN || !approvalKey) return;
    for (const trId of ["H0STCNT0", "H0STASP0"]) {
      socket.send(JSON.stringify({
        header: { approval_key: approvalKey, custtype: "P", tr_type: trType, "content-type": "utf-8" },
        body: { input: { tr_id: trId, tr_key: symbol } },
      }));
    }
  };

  const rememberConfirmedSubscription = (symbol, trId) => {
    if (!symbol || !trId || !subscriptions.has(symbol)) return;
    const confirmed = confirmedSubscriptions.get(symbol) || new Set();
    confirmed.add(trId);
    confirmedSubscriptions.set(symbol, confirmed);
  };

  // 이미 상위 KIS 구독이 살아 있으면 새 브라우저에도 현재 승인 상태를 즉시 알려준다.
  const replayConfirmedSubscriptions = (client, symbol) => {
    for (const trId of confirmedSubscriptions.get(symbol) || []) {
      send(client.socket, { type: "subscription", data: { ok: true, trId, symbol, message: "기존 KIS 구독을 공유합니다." } });
    }
  };

  // 메시지를 받은 KIS 소켓을 클로저로 받아 PINGPONG 응답이 교체된 연결로 가지 않게 한다.
  const handleUpstreamMessage = (socket, data) => {
    const message = data.toString();
    lastMessageAt = new Date().toISOString();
    if (message.startsWith("0|")) {
      const [, trId, countText, payload = ""] = message.split("|", 4);
      const count = Math.max(1, Number(countText) || 1);
      const fieldsPerTrade = 46;
      if (trId === "H0STCNT0") {
        const fields = payload.split("^");
        for (let index = 0; index < count; index += 1) {
          const quote = ingestQuote(parseTrade(fields.slice(index * fieldsPerTrade, (index + 1) * fieldsPerTrade).join("^")));
          if (quote) broadcast({ type: "quote", data: quote }, quote.symbol);
        }
      } else if (trId === "H0STASP0") {
        const book = parseOrderBook(payload);
        // 캐시는 지원 종목으로 한정해 크기를 제한하고, 재구독 시 장 마감 후에도 마지막 호가를 바로 보여준다.
        if (book.symbol && isSupportedSymbol(book.symbol)) {
          orderBooks.set(book.symbol, book);
          broadcast({ type: "orderbook", data: book }, book.symbol);
        }
      }
      return;
    }
    try {
      const parsed = JSON.parse(message);
      if (parsed?.header?.tr_id === "PINGPONG") {
        if (socket.readyState === WebSocket.OPEN) socket.send(message);
      } else if (parsed?.body?.rt_cd === "1") {
        lastError = { message: parsed.body.msg1 || "KIS 구독 실패", occurredAt: new Date().toISOString() };
        broadcast({ type: "subscription", data: { ok: false, trId: parsed?.header?.tr_id, symbol: parsed?.header?.tr_key, message: parsed.body.msg1 } }, parsed?.header?.tr_key);
      } else if (parsed?.body?.rt_cd === "0" && parsed?.header?.tr_id) {
        rememberConfirmedSubscription(parsed.header.tr_key, parsed.header.tr_id);
        broadcast({ type: "subscription", data: { ok: true, trId: parsed.header.tr_id, symbol: parsed.header.tr_key, message: parsed.body.msg1 } }, parsed.header.tr_key);
      }
    } catch { /* 알 수 없는 KIS 프레임은 다음 정상 프레임을 계속 기다린다. */ }
  };

  const scheduleReconnect = () => {
    if (stopping || reconnectTimer || subscriptions.size === 0) return;
    // 여러 서버가 동시에 재접속하지 않도록 지수 백오프에 지터를 더한다.
    const delay = Math.round(Math.min(30_000, 1_000 * (2 ** reconnectAttempts)) * (0.75 + Math.random() * 0.5));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect().catch(() => undefined); }, delay);
    reconnectTimer.unref?.();
  };

  const openUpstream = async () => {
    try {
      const key = await getApprovalKey();
      if (stopping || subscriptions.size === 0) return;
      approvalKey = key;
      const socket = new WebSocket(upstreamUrl(), { handshakeTimeout: 10_000 });
      upstream = socket;
      socket.on("open", () => {
        if (upstream !== socket) return;
        reconnectAttempts = 0; connectedAt = new Date().toISOString(); lastError = null; confirmedSubscriptions.clear();
        for (const symbol of subscriptions.keys()) requestSubscription(symbol);
        broadcast({ type: "status", data: getStatus() });
      });
      socket.on("message", (data) => { if (upstream === socket) handleUpstreamMessage(socket, data); });
      socket.on("error", (error) => {
        if (upstream === socket) lastError = { message: error.message, occurredAt: new Date().toISOString() };
      });
      socket.on("close", () => {
        // 이미 교체되었거나 종료 중에 정리된 연결의 close는 현재 상태를 바꾸지 않는다.
        if (upstream !== socket) return;
        upstream = null; connectedAt = null; confirmedSubscriptions.clear();
        broadcast({ type: "status", data: getStatus() });
        scheduleReconnect();
      });
    } catch (error) {
      lastError = { message: error.message, occurredAt: new Date().toISOString() };
      broadcast({ type: "status", data: getStatus() });
      scheduleReconnect();
    }
  };

  const connect = () => {
    if (stopping || subscriptions.size === 0) return Promise.resolve();
    if (upstream?.readyState === WebSocket.OPEN || upstream?.readyState === WebSocket.CONNECTING) return Promise.resolve();
    if (!connecting) connecting = openUpstream().finally(() => { connecting = null; });
    return connecting;
  };

  const rejectSubscription = (client, symbol, reason, message) => {
    send(client.socket, { type: "subscription", data: { ok: false, symbol: symbol.slice(0, 20), reason, message } });
  };

  const addSubscription = (client, rawSymbol) => {
    const symbol = String(rawSymbol ?? "").trim();
    if (!isSupportedSymbol(symbol)) {
      rejectSubscription(client, symbol, "unsupported", "실시간 시세를 지원하지 않는 종목입니다.");
      return;
    }
    if (client.symbols.has(symbol)) return;
    if (client.symbols.size >= maxSymbolsPerClient) {
      rejectSubscription(client, symbol, "client-limit", `한 연결에서는 실시간 시세를 최대 ${maxSymbolsPerClient}개 종목까지 구독할 수 있습니다.`);
      return;
    }
    const count = subscriptions.get(symbol) || 0;
    if (count === 0 && subscriptions.size >= maxTotalSymbols) {
      rejectSubscription(client, symbol, "server-limit", "실시간 시세 구독 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    client.symbols.add(symbol);
    subscriptions.set(symbol, count + 1);
    if (count === 0) requestSubscription(symbol);
    else replayConfirmedSubscriptions(client, symbol);
    const cachedBook = orderBooks.get(symbol);
    if (cachedBook) send(client.socket, { type: "orderbook", data: cachedBook });
    connect().catch(() => undefined);
  };

  const removeSubscription = (client, symbol) => {
    if (!client.symbols.delete(symbol)) return;
    const next = Math.max(0, (subscriptions.get(symbol) || 1) - 1);
    if (next === 0) {
      subscriptions.delete(symbol); confirmedSubscriptions.delete(symbol);
      requestSubscription(symbol, "2");
    } else subscriptions.set(symbol, next);
  };

  // 구독/해지를 빠르게 반복해 KIS 등록 요청을 폭주시키지 못하도록 연결별 메시지 수를 제한한다.
  const allowMessage = (client) => {
    const now = Date.now();
    if (now - client.windowStartedAt >= messageWindowMs) {
      client.windowStartedAt = now;
      client.messageCount = 0;
    }
    client.messageCount += 1;
    return client.messageCount <= maxMessagesPerWindow;
  };

  const handleConnection = (socket) => {
    // ws는 maxPayload 초과 등 프로토콜 오류를 error 이벤트로 알리므로 처리기가 없으면 프로세스가 종료된다.
    socket.on("error", () => undefined);
    if (stopping || clients.size >= maxClients) {
      socket.close(1013, "server busy");
      return;
    }
    const client = { socket, symbols: new Set(), alive: true, windowStartedAt: Date.now(), messageCount: 0 };
    clients.add(client);
    send(socket, { type: "status", data: getStatus() });
    socket.on("pong", () => { client.alive = true; });
    socket.on("message", (raw) => {
      client.alive = true;
      if (!allowMessage(client)) {
        socket.close(1008, "too many messages");
        return;
      }
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: "error", error: "잘못된 WebSocket 요청입니다." });
        return;
      }
      if (message?.type === "subscribe") addSubscription(client, message.symbol);
      else if (message?.type === "unsubscribe") removeSubscription(client, String(message.symbol ?? "").trim());
    });
    socket.on("close", () => {
      for (const symbol of [...client.symbols]) removeSubscription(client, symbol);
      clients.delete(client);
    });
  };

  // 응답하지 않는 브라우저 연결은 다음 확인 주기에 강제로 끊어 구독 수와 소켓을 회수한다.
  const checkHeartbeats = () => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      try { client.socket.ping(); } catch { client.socket.terminate(); }
    }
  };

  const attach = (server) => {
    if (wss) return wss;
    wss = new WebSocketServer({ server, path: "/ws/market", maxPayload });
    wss.on("connection", handleConnection);
    heartbeatTimer = setInterval(checkHeartbeats, heartbeatMs);
    heartbeatTimer.unref?.();
    return wss;
  };

  // HTTP 서버 종료가 열린 WebSocket 때문에 지연되지 않도록 상위·브라우저 연결을 모두 끊는다.
  const stop = () => {
    stopping = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    const socket = upstream;
    upstream = null;
    connectedAt = null;
    socket?.terminate();
    for (const client of [...clients]) client.socket.terminate();
    clients.clear();
    subscriptions.clear();
    confirmedSubscriptions.clear();
    orderBooks.clear();
    wss?.close();
    wss = null;
  };

  return { attach, getStatus, stop };
}

export default createMarketWebSocketService();
