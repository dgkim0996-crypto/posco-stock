import { Router } from "express";
import { getFeedArticle, getInvestmentFeed } from "../controllers/feed.controller.js";
const router = Router();
// 목록과 본문을 분리해 목록 갱신과 개별 기사 파싱이 서로 지연시키지 않게 한다.
router.get("/feed", getInvestmentFeed);
router.get("/feed/article", getFeedArticle);
export default router;
