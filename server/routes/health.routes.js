import { Router } from "express";
import operationsService from "../services/operations.service.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

// 외부 API와 무관하게 Express 서버 프로세스가 응답 가능한지 확인한다.
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "POSCO Securities API is running",
  });
});

router.get("/health/ready", async (_req, res, next) => {
  try {
    const status = await operationsService.getStatus();
    return res.status(status.ready ? 200 : 503).json({ status: status.status, ready: status.ready, checkedAt: status.checkedAt });
  } catch (error) {
    return next(error);
  }
});

router.get("/operations/status", requireAccount, async (_req, res, next) => {
  try {
    return res.json(await operationsService.getStatus());
  } catch (error) {
    return next(error);
  }
});

export default router;
