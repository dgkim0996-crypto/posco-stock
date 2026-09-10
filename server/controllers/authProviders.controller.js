import naverAuthService from "../services/naverAuth.service.js";

/** Supabase Custom OAuth가 사용할 네이버 표준 UserInfo 응답을 제공한다. */
export const getNaverUserInfo = async (req, res, next) => {
  try {
    const profile = await naverAuthService.getNaverUserInfo(req.get("authorization"));
    res.set("Cache-Control", "no-store");
    return res.json(profile);
  } catch (error) {
    return next(error);
  }
};
