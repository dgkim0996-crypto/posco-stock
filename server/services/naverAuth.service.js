const NAVER_USERINFO_URL = "https://openapi.naver.com/v1/nid/me";
const MAX_AUTHORIZATION_LENGTH = 4096;

/** 네이버의 중첩 프로필 응답을 Supabase Custom OAuth가 읽는 표준 Claim 형태로 변환한다. */
export function normalizeNaverProfile(payload) {
  const profile = payload?.response;
  const subject = typeof profile?.id === "string" ? profile.id.trim() : "";
  const email = typeof profile?.email === "string" ? profile.email.trim() : "";

  if (!subject) {
    const error = new Error("네이버 사용자 식별 정보를 확인하지 못했습니다.");
    error.status = 502;
    throw error;
  }
  if (!email) {
    const error = new Error("네이버 로그인에서 이메일 제공 동의가 필요합니다.");
    error.status = 422;
    throw error;
  }

  const name = profile.name || profile.nickname || "네이버 사용자";
  return {
    sub: subject,
    id: subject,
    email,
    email_verified: true,
    name,
    full_name: name,
    nickname: profile.nickname || name,
    preferred_username: profile.nickname || name,
    picture: profile.profile_image || null,
    avatar_url: profile.profile_image || null,
  };
}

/** Supabase가 전달한 일회성 Bearer 토큰으로 네이버 프로필을 조회하고 표준 Claim을 반환한다. */
export async function getNaverUserInfo(authorization) {
  if (
    typeof authorization !== "string"
    || authorization.length > MAX_AUTHORIZATION_LENGTH
    || !/^Bearer\s+\S+$/i.test(authorization)
  ) {
    const error = new Error("유효한 네이버 접근 토큰이 필요합니다.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(NAVER_USERINFO_URL, {
    headers: {
      Accept: "application/json",
      Authorization: authorization,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.resultcode !== "00") {
    const error = new Error(payload.message || `네이버 프로필 조회 실패 (${response.status})`);
    error.status = response.status >= 400 && response.status < 500 ? 401 : 502;
    throw error;
  }

  return normalizeNaverProfile(payload);
}

export default { getNaverUserInfo, normalizeNaverProfile };
