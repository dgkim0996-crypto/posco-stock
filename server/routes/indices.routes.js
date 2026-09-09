import { Router } from "express";
import { getMarketIndices } from "../controllers/indices.controller.js";

const router = Router();
router.get("/indices", getMarketIndices);
export default router;
