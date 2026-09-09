import requestMetricsService from "../services/requestMetrics.service.js";

export const requestMetrics = (req, res, next) => {
  const path = req.originalUrl.split("?", 1)[0];
  const excluded = path === "/api/health" || path === "/api/health/ready" || path === "/api/operations/status";
  if (excluded) return next();
  const startedAt = process.hrtime.bigint();
  requestMetricsService.recordStart();
  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    requestMetricsService.recordFinish({
      durationMs,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
    });
  });
  next();
};
