import { Router } from "express";
import { getMarketStatus, getQuoteBySymbol, getQuotes } from "../controllers/quotes.controller.js";

const router = Router();

// 전체 시세, 단일 시세, KIS 수집 상태를 각각 제공한다.
router.get("/quotes", getQuotes);
router.get("/quotes/:symbol", getQuoteBySymbol);
router.get("/market/status", getMarketStatus);

export default router;
