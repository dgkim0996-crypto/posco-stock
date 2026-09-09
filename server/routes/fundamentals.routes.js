import { Router } from "express";
import { getStockFundamentals } from "../controllers/fundamentals.controller.js";

const router = Router();
router.get("/fundamentals/:symbol", getStockFundamentals);
export default router;
