import { createAdvisorAnalysis } from "../services/advisor.service.js";

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
