import { Router } from "express";
import { getChart } from "../controllers/charts.controller.js";

const router = Router();
router.get("/charts/:symbol", getChart);
export default router;
