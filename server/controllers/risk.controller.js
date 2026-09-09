import service from "../services/risk.service.js";

/** 선물·금융 위험을 평가하며, autoLiquidate=false면 조회 전용으로 동작한다. */
export async function evaluateRisk(req, res, next) {
  try { return res.json(await service.evaluate(req.accountId, { autoLiquidate: req.query.autoLiquidate !== "false" })); } catch (error) { return next(error); }
}
