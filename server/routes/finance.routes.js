import {Router} from "express";
import {executeFinance,getFinance,settleFinance} from "../controllers/finance.controller.js";
import {requireAccount} from "../middleware/auth.js";
const router=Router();
router.use("/accounts",requireAccount);
router.get("/accounts/me/finance",getFinance);
router.post("/accounts/me/finance/:product/execute",executeFinance);
router.post("/accounts/me/finance/:product/settle",settleFinance);
export default router;
