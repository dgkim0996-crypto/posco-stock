import { Router } from "express";
import { getInvestmentFeed } from "../controllers/feed.controller.js";
const router = Router();
router.get("/feed", getInvestmentFeed);
export default router;
