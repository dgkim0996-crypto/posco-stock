import { Router } from "express";
import { getChart } from "../controllers/charts.controller.js";

const router = Router();
// 예: GET /api/charts/005490?period=5m
router.get("/charts/:symbol", getChart);
export default router;
