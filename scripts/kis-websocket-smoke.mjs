import "dotenv/config";
import WebSocket from "ws";

const port = process.env.PORT || 3001;
const observeMs = Number(process.env.KIS_WS_OBSERVE_MS || 15_000);
const socket = new WebSocket(`ws://localhost:${port}/ws/market`);
const result = { internalConnected: false, kisConnected: false, tradeSubscription: false, orderBookSubscription: false, quoteReceived: false, orderBookReceived: false, quoteMessages: 0, orderBookMessages: 0 };
let observationTimer = null;
const finish = (label, code) => {
  clearTimeout(timeout);
  clearTimeout(observationTimer);
  console.log(JSON.stringify({ ...result, observedMs: observeMs, result: label }, null, 2));
  socket.send(JSON.stringify({ type: "unsubscribe", symbol: "005930" }));
  socket.close();
  process.exitCode = code;
};
const timeout = setTimeout(() => {
  const subscriptionsAccepted = result.tradeSubscription && result.orderBookSubscription;
  finish(result.internalConnected && result.kisConnected && subscriptionsAccepted ? "PASS_MARKET_CLOSED" : "FAIL", result.internalConnected && result.kisConnected && subscriptionsAccepted ? 0 : 1);
}, Math.max(25_000, observeMs + 15_000));

socket.on("open", () => {
  result.internalConnected = true;
  socket.send(JSON.stringify({ type: "subscribe", symbol: "005930" }));
});
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.type === "status" && message.data?.connected) result.kisConnected = true;
  if (message.type === "subscription" && message.data?.ok && message.data?.trId === "H0STCNT0") result.tradeSubscription = true;
  if (message.type === "subscription" && message.data?.ok && message.data?.trId === "H0STASP0") result.orderBookSubscription = true;
  if (message.type === "quote" && message.data?.symbol === "005930") { result.quoteReceived = true; result.quoteMessages += 1; }
  if (message.type === "orderbook" && message.data?.symbol === "005930") { result.orderBookReceived = true; result.orderBookMessages += 1; }
  if (!observationTimer && result.kisConnected && result.quoteReceived && result.orderBookReceived) {
    observationTimer = setTimeout(() => finish("PASS", 0), observeMs);
  }
});
socket.on("error", (error) => { clearTimeout(timeout); clearTimeout(observationTimer); console.error(error); process.exitCode = 1; });
