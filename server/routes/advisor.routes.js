import { Router } from "express";
import { createAdvisor } from "../controllers/advisor.controller.js";
import { requireAccount } from "../middleware/auth.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const advisorRateLimit = createRateLimit({
  windowMs: 10 * 60 * 1_000,
  max: Number(process.env.ADVISOR_RATE_LIMIT_MAX) || 5,
  key: (req) => req.authUser.id,
  message: "AI 분석은 10분에 5회까지 요청할 수 있습니다. 잠시 후 다시 시도해 주세요.",
});

// 외부 AI 호출은 로그인한 사용자만, 사용자별 제한 안에서 실행한다.
router.post("/advisor/analyze", requireAccount, advisorRateLimit, createAdvisor);
export default router;
