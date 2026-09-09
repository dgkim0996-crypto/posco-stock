import { Router } from "express";
import { executeFinance, getFinance, settleFinance } from "../controllers/finance.controller.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

// 금융 약정은 계좌 잔고에 영향을 주므로 본인 인증을 모든 경로에 적용한다.
router.use("/accounts", requireAccount);
router.get("/accounts/me/finance", getFinance);
router.post("/accounts/me/finance/:product/execute", executeFinance);
router.post("/accounts/me/finance/:product/settle", settleFinance);

export default router;
