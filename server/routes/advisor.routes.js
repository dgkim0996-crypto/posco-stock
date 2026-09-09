import { Router } from "express";
import { createAdvisor } from "../controllers/advisor.controller.js";

const router = Router();
router.post("/advisor/analyze", createAdvisor);
export default router;
