import { Router } from "express";
import { getDatabaseStatus } from "../controllers/database.controller.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

// DB 연결 점검은 Supabase 왕복을 일으키고 운영 정보를 드러내므로 로그인 사용자만 호출한다.
router.get("/database/status", requireAccount, getDatabaseStatus);

export default router;
