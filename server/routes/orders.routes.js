import { Router } from "express";
import { createOrder, getOrders } from "../controllers/orders.controller.js";

const router = Router();

router.get("/orders", getOrders);
router.post("/orders", createOrder);

export default router;
