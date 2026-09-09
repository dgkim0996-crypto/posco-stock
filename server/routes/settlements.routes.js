import { Router } from "express";
import { getChargePolicies, getSettlements } from "../controllers/settlements.controller.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

// 결제 내역은 개인 거래 기록이므로 인증된 계좌에서만 조회한다.
router.use("/accounts", requireAccount);
router.get("/accounts/me/settlements", getSettlements);
router.get("/accounts/me/trade-charge-policies", getChargePolicies);

export default router;
