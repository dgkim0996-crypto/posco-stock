import { Router } from "express";
import { getChargePolicies, getSettlements } from "../controllers/settlements.controller.js";
import { requireAccount } from "../middleware/auth.js";
const router=Router();
router.use("/accounts",requireAccount);
router.get("/accounts/me/settlements",getSettlements);
router.get("/accounts/me/trade-charge-policies",getChargePolicies);
export default router;
