import { Router } from "express";
import { getAlternativeChart } from "../controllers/alternativeCharts.controller.js";

const router = Router();
router.get("/alternative-charts/:category/:symbol", getAlternativeChart);
export default router;
