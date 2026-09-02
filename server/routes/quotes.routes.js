import { Router } from "express";
import { getMarketStatus, getQuoteBySymbol, getQuotes } from "../controllers/quotes.controller.js";

const router = Router();

router.get("/quotes", getQuotes);
router.get("/quotes/:symbol", getQuoteBySymbol);
router.get("/market/status", getMarketStatus);

export default router;
