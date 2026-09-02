import { Router } from "express";
import { getAccountById, getAccountHoldings } from "../controllers/accounts.controller.js";

const router = Router();

router.get("/accounts/:id", getAccountById);
router.get("/accounts/:id/holdings", getAccountHoldings);

export default router;
