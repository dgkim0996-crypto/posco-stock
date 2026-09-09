import { Router } from "express";
import { evaluateRisk } from "../controllers/risk.controller.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

// 위험 평가는 사용자별 자산·부채를 읽고 강제청산할 수 있어 반드시 인증한다.
router.use("/accounts", requireAccount);
router.get("/accounts/me/risk", evaluateRisk);

export default router;
