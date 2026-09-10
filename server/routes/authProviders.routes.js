import { Router } from "express";
import { getNaverUserInfo } from "../controllers/authProviders.controller.js";

const router = Router();

// Supabase Auth 서버가 네이버 access token으로 호출하는 공개 UserInfo 변환 경로다.
router.get("/auth/naver/userinfo", getNaverUserInfo);

export default router;
