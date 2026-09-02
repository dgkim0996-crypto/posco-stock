import { Router } from "express";
import { getAllInstruments, getInstrumentBySymbol } from "../controllers/instruments.controller.js";

const router = Router();

router.get("/instruments", getAllInstruments);
router.get("/instruments/:symbol", getInstrumentBySymbol);

export default router;
