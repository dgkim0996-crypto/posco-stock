import { Router } from "express";
import { createOrder, getOrders } from "../controllers/orders.controller.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

// GET은 체결내역 조회, POST는 모의 주문 생성에 사용한다.
router.use("/orders", requireAccount);
router.get("/orders", getOrders);
router.post("/orders", createOrder);

export default router;
