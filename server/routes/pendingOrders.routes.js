import { Router } from "express";
import { amendPendingOrder, cancelPendingOrder, createPendingOrder, getPendingOrders } from "../controllers/pendingOrders.controller.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

// 미체결 주문은 다른 사용자가 조회·정정할 수 없도록 계좌 인증을 먼저 강제한다.
router.use("/accounts", requireAccount);
router.get("/accounts/me/pending-orders", getPendingOrders);
router.post("/accounts/me/pending-orders", createPendingOrder);
router.patch("/accounts/me/pending-orders/:pendingId", amendPendingOrder);
router.delete("/accounts/me/pending-orders/:pendingId", cancelPendingOrder);

export default router;
