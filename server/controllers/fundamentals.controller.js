import { getFundamentals } from "../services/fundamentals.service.js";

// 응답에 그대로 돌려주는 값이므로 종목코드 형식과 길이를 먼저 제한한다.
const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;

export async function getStockFundamentals(req, res, next) {
  try {
    const symbol = String(req.params.symbol || "").trim();
    if (!SYMBOL_PATTERN.test(symbol)) return res.status(400).json({ error: "종목코드가 올바르지 않습니다." });
    return res.json(await getFundamentals(symbol));
  } catch (error) {
    return next(error);
  }
}
