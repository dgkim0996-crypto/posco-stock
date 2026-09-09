import { Router } from "express";
import { applyCashOperation, getAccountById, getAccountHoldings, getAccountLedger, getAccountState, getOrderEvents, resetAccount } from "../controllers/accounts.controller.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

router.use("/accounts", requireAccount);
// 로그인 토큰으로 식별한 본인 계좌만 조회·변경한다.
router.get("/accounts/me", getAccountById);
router.get("/accounts/me/holdings", getAccountHoldings);
router.get("/accounts/me/state", getAccountState);
router.get("/accounts/me/ledger", getAccountLedger);
router.get("/accounts/me/order-events", getOrderEvents);
router.post("/accounts/me/cash", applyCashOperation);
router.post("/accounts/me/reset", resetAccount);

export default router;
