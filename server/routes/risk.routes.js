import{Router}from"express";import{evaluateRisk}from"../controllers/risk.controller.js";import{requireAccount}from"../middleware/auth.js";
const router=Router();router.use("/accounts",requireAccount);router.get("/accounts/me/risk",evaluateRisk);export default router;
