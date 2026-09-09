import { getFundamentals } from "../services/fundamentals.service.js";

export async function getStockFundamentals(req, res, next) {
  try { res.json(await getFundamentals(req.params.symbol)); } catch (error) { next(error); }
}
