import { Router } from "express";
import { getStockFundamentals } from "../controllers/fundamentals.controller.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
// 공개 경로이지만 KIS 직렬 큐를 사용하므로 IP별 호출 수를 제한한다.
const fundamentalsRateLimit = createRateLimit({
  windowMs: 60 * 1_000,
  max: Number(process.env.FUNDAMENTALS_RATE_LIMIT_MAX) || 30,
  message: "재무지표 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
});

router.get("/fundamentals/:symbol", fundamentalsRateLimit, getStockFundamentals);
export default router;
