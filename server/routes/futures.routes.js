import { Router } from "express";
import { closeFuture, getFutures, openFuture } from "../controllers/futures.controller.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

// 모든 선물 조회·주문은 인증 토큰으로 확인한 본인 계좌에만 적용한다.
router.use("/accounts", requireAccount);
router.get("/accounts/me/futures", getFutures);
router.post("/accounts/me/futures", openFuture);
router.post("/accounts/me/futures/:positionId/close", closeFuture);

export default router;
