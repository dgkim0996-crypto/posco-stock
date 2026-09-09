import { Router } from "express";
import { getAllInstruments, getInstrumentBySymbol } from "../controllers/instruments.controller.js";

const router = Router();

// 목록은 쿼리 필터를 지원하고, :symbol 경로는 단일 종목을 조회한다.
router.get("/instruments", getAllInstruments);
router.get("/instruments/:symbol", getInstrumentBySymbol);

export default router;
