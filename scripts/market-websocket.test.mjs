import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket, { WebSocketServer } from "ws";

// 시세 저장소가 저장소 폴더의 캐시를 건드리지 않도록 임시 폴더에서 서비스를 불러온다.
process.chdir(await mkdtemp(path.join(tmpdir(), "posco-market-ws-")));
const { createMarketWebSocketService } = await import("../server/services/kisWebSocket.service.js");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitFor = async (predicate, label, timeoutMs = 2_000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error(`시간 안에 조건을 만족하지 못했습니다: ${label}`);
    await wait(10);
  }
};

// KIS 실시간 서버 대역. 연결 수와 등록 요청을 기록하고 등록 성공 응답을 돌려준다.
const kis = new WebSocketServer({ port: 0, host: "127.0.0.1" });
const kisConnections = [];
const kisRequests = [];
kis.on("connection", (socket) => {
  kisConnections.push(socket);
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    kisRequests.push(message);
    const { tr_id: trId, tr_key: symbol } = message.body.input;
    socket.send(JSON.stringify({ header: { tr_id: trId, tr_key: symbol }, body: { rt_cd: "0", msg1: "SUBSCRIBE SUCCESS" } }));
  });
});
await once(kis, "listening");

let approvalRequests = 0;
const service = createMarketWebSocketService({
  getApprovalKey: async () => { approvalRequests += 1; await wait(50); return "approval-key"; },
  upstreamUrl: () => `ws://127.0.0.1:${kis.address().port}`,
  maxSymbolsPerClient: 3,
  maxTotalSymbols: 4,
  heartbeatMs: 100,
});
const httpServer = createServer();
service.attach(httpServer);
httpServer.listen(0, "127.0.0.1");
await once(httpServer, "listening");
const marketUrl = `ws://127.0.0.1:${httpServer.address().port}/ws/market`;

after(async () => {
  service.stop();
  for (const socket of kis.clients) socket.terminate();
  await new Promise((resolve) => kis.close(resolve));
  httpServer.closeAllConnections();
  await new Promise((resolve) => httpServer.close(resolve));
});

const openClient = async (options) => {
  const socket = new WebSocket(marketUrl, options);
  const messages = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  const closed = once(socket, "close").then(([code]) => code);
  await once(socket, "open");
  await waitFor(() => messages.some((message) => message.type === "status"), "initial status");
  return { socket, messages, closed };
};
const subscribe = (client, symbol) => client.socket.send(JSON.stringify({ type: "subscribe", symbol }));
const rejection = (client, symbol) => client.messages.find((message) => message.type === "subscription" && message.data?.ok === false && message.data.symbol === symbol);
const subscribeRequests = () => kisRequests.filter((message) => message.header.tr_type === "1");

const first = await openClient();
const second = await openClient();

test("rapid subscriptions share one KIS approval and one upstream connection", async () => {
  for (const symbol of ["005490", "003670", "047050"]) subscribe(first, symbol);
  await waitFor(() => subscribeRequests().length === 6, "three symbols registered for trades and order books");
  assert.equal(approvalRequests, 1);
  assert.equal(kisConnections.length, 1);
  assert.equal(service.getStatus().connected, true);
});

test("each browser connection may subscribe to at most three symbols", async () => {
  subscribe(first, "022100");
  await waitFor(() => rejection(first, "022100"), "per-client rejection");
  assert.equal(rejection(first, "022100").data.reason, "client-limit");
  assert.deepEqual(service.getStatus().subscribedSymbols.sort(), ["003670", "005490", "047050"]);
});

test("distinct symbols across all connections are capped while shared symbols still work", async () => {
  subscribe(second, "005490");
  subscribe(second, "022100");
  subscribe(second, "058430");
  await waitFor(() => rejection(second, "058430"), "server-wide rejection");
  assert.equal(rejection(second, "058430").data.reason, "server-limit");
  assert.equal(rejection(second, "005490"), undefined, "an already registered symbol can be shared");
  assert.equal(service.getStatus().subscribedSymbols.length, 4);
  await waitFor(() => second.messages.some((message) => message.type === "subscription" && message.data?.ok && message.data.symbol === "005490"), "shared subscription confirmation");
});

test("unsupported symbols, oversized frames and message floods are rejected without crashing", async () => {
  const client = await openClient();
  subscribe(client, "AAPL");
  await waitFor(() => rejection(client, "AAPL"), "unsupported rejection");
  assert.equal(rejection(client, "AAPL").data.reason, "unsupported");

  const oversized = await openClient();
  oversized.socket.send("x".repeat(4_096));
  assert.equal(await oversized.closed, 1009);

  const flooding = await openClient();
  for (let index = 0; index < 50; index += 1) flooding.socket.send(JSON.stringify({ type: "unsubscribe", symbol: "005490" }));
  assert.equal(await flooding.closed, 1008);
  client.socket.close();
  await client.closed;
});

test("connections that stop answering pings are terminated and release their subscriptions", async () => {
  const silent = await openClient({ autoPong: false });
  subscribe(silent, "047050");
  await waitFor(() => service.getStatus().clientCount === 3, "silent client registered");
  assert.equal(await silent.closed, 1006);
  await waitFor(() => service.getStatus().clientCount === 2, "dead client removed");
});

test("stop terminates browser and upstream sockets so the HTTP server can close", async () => {
  const upstream = kisConnections[0];
  const upstreamClosed = once(upstream, "close");
  service.stop();
  await Promise.all([first.closed, second.closed, upstreamClosed]);
  assert.equal(service.getStatus().clientCount, 0);
  assert.equal(service.getStatus().connected, false);
  assert.equal(httpServer.listenerCount("upgrade"), 0, "the WebSocket server detaches from the HTTP server");
});
