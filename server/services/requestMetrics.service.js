const startedAt = new Date().toISOString();
let totalRequests = 0;
let activeRequests = 0;
let serverErrors = 0;
let totalDurationMs = 0;
let slowestRequestMs = 0;
let lastRequestAt = null;
let lastServerError = null;

const recordStart = () => {
  totalRequests += 1;
  activeRequests += 1;
  lastRequestAt = new Date().toISOString();
};

const recordFinish = ({ durationMs, method, path, statusCode }) => {
  activeRequests = Math.max(0, activeRequests - 1);
  totalDurationMs += durationMs;
  slowestRequestMs = Math.max(slowestRequestMs, durationMs);
  if (statusCode >= 500) {
    serverErrors += 1;
    lastServerError = { method, path, statusCode, occurredAt: new Date().toISOString() };
  }
};

const getStatus = () => ({
  startedAt,
  uptimeSeconds: Math.floor(process.uptime()),
  totalRequests,
  activeRequests,
  serverErrors,
  errorRate: totalRequests ? Number((serverErrors / totalRequests).toFixed(4)) : 0,
  averageDurationMs: totalRequests ? Number((totalDurationMs / totalRequests).toFixed(1)) : 0,
  slowestRequestMs: Number(slowestRequestMs.toFixed(1)),
  lastRequestAt,
  lastServerError,
});

export default { getStatus, recordFinish, recordStart };
