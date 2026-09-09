import { Router } from "express";
import { getDatabaseStatus } from "../controllers/database.controller.js";

const router = Router();

router.get("/database/status", getDatabaseStatus);

export default router;
