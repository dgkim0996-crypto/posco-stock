import { Router } from "express";
import { getAlternativeQuotes } from "../controllers/alternativeQuotes.controller.js";

const router = Router();
router.get("/alternative-quotes", getAlternativeQuotes);
export default router;
