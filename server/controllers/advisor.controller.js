import { createAdvisorAnalysis } from "../services/advisor.service.js";

export async function createAdvisor(req, res, next) {
  try { res.json(await createAdvisorAnalysis(req.body || {})); } catch (error) { next(error); }
}
