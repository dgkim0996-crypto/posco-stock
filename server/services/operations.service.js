import databaseService from "./database.service.js";
import kisWebSocketService from "./kisWebSocket.service.js";
import marketDataService from "./marketData.service.js";
import marketDatabaseService from "./marketDatabase.service.js";
import requestMetricsService from "./requestMetrics.service.js";

const component = (status, details) => ({ status, ...details });

const getStatus = async () => {
  let accountDatabase;
  try {
    const status = await databaseService.getStatus();
    accountDatabase = component(status.connected || status.mode === "memory" ? "ok" : "degraded", status);
  } catch (error) {
    accountDatabase = component("down", { configured: true, connected: false, message: error.message });
  }

  let marketCache;
  try {
    marketCache = component("ok", marketDatabaseService.getStatus());
  } catch (error) {
    marketCache = component("down", { connected: false, message: error.message });
  }

  const rest = marketDataService.getStatus();
  const realtime = kisWebSocketService.getStatus();
  const requestMetrics = requestMetricsService.getStatus();
  const components = {
    accountDatabase,
    marketCache,
    marketRest: component(rest.ok ? "ok" : rest.cachedSymbols > 0 ? "degraded" : "down", rest),
    marketRealtime: component(realtime.connected ? "ok" : realtime.subscribedSymbols.length ? "degraded" : "idle", realtime),
    http: component(requestMetrics.errorRate >= 0.05 ? "degraded" : "ok", requestMetrics),
  };
  const states = Object.values(components).map(({ status }) => status);
  const status = states.includes("down") ? "down" : states.includes("degraded") ? "degraded" : "ok";

  return {
    status,
    ready: accountDatabase.status !== "down" && marketCache.status !== "down",
    checkedAt: new Date().toISOString(),
    components,
  };
};

export default { getStatus };
