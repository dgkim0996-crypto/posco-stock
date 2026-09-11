import { createAdvisorAnalysis, createFundamentalAnalysis } from "../services/advisor.service.js";

const createError = (status, message) => Object.assign(new Error(message), { status });

function validateAnalysisInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw createError(400, "분석 요청 형식이 올바르지 않습니다.");
  if (! ["pension", "isa", "retirement", "wrap"].includes(input.product)) throw createError(400, "지원하지 않는 상품입니다.");
  if (! ["conservative", "balanced", "growth"].includes(input.profile)) throw createError(400, "지원하지 않는 투자성향입니다.");
  if (!Array.isArray(input.indices) || input.indices.length > 20) throw createError(400, "지수 데이터는 20개 이하로 보내야 합니다.");
  if (!Array.isArray(input.candidates) || input.candidates.length < 3 || input.candidates.length > 40) {
    throw createError(400, "분석 후보는 3개 이상 40개 이하로 보내야 합니다.");
  }
  return input;
}

export async function createAdvisor(req, res, next) {
  try { res.json(await createAdvisorAnalysis(validateAnalysisInput(req.body))); } catch (error) { next(error); }
}

const FUNDAMENTAL_KEYS = new Set(["per", "pbr", "roe", "eps", "bps", "marketCap", "listedShares", "debtRatio", "foreignOwnership", "salesGrowth", "operatingGrowth", "netIncomeGrowth", "volumeTurnover", "high250", "low250"]);

function validateFundamentalInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw createError(400, "분석 요청 형식이 올바르지 않습니다.");
  if (!/^\d{6}$/.test(String(input.symbol || ""))) throw createError(400, "국내주식 종목코드가 올바르지 않습니다.");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 80) throw createError(400, "종목명이 올바르지 않습니다.");
  if (!input.metrics || typeof input.metrics !== "object" || Array.isArray(input.metrics)) throw createError(400, "재무지표가 올바르지 않습니다.");
  const metrics = {};
  for (const [key, value] of Object.entries(input.metrics)) {
    if (!FUNDAMENTAL_KEYS.has(key)) continue;
    if (value !== null && (!Number.isFinite(value) || Math.abs(value) > 1e16)) throw createError(400, `${key} 지표가 올바르지 않습니다.`);
    metrics[key] = value;
  }
  if (!Object.values(metrics).some(Number.isFinite)) throw createError(400, "분석할 수 있는 재무지표가 없습니다.");
  return {
    symbol: input.symbol,
    name: input.name.trim(),
    period: typeof input.period === "string" ? input.period.slice(0, 20) : null,
    source: typeof input.source === "string" ? input.source.slice(0, 80) : null,
    metrics,
  };
}

export async function createFundamentalAdvisor(req, res, next) {
  try { res.json(await createFundamentalAnalysis(validateFundamentalInput(req.body))); } catch (error) { next(error); }
}
