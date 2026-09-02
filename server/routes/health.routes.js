import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "POSCO Securities API is running",
  });
});

export default router;
