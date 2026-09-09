import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// KIS 인증 전담 서비스. 저장 토큰 확인 → 유효 토큰 재사용 → 필요할 때만 신규 발급 순으로 동작한다.

const KIS_BASE_URLS = {
  real: "https://openapi.koreainvestment.com:9443",
  paper: "https://openapivts.koreainvestment.com:29443",
};

let accessToken = null;
let expiresAt = 0;
let tokenRequest = null;
let tokenRetryAt = 0;
let lastTokenError = null;
let cacheLoaded = false;

const TOKEN_CACHE_PATH = path.resolve(".cache", "kis-token.json");
// 앱 키가 바뀌면 과거 토큰을 재사용하지 않도록 환경과 앱 키를 해시로 식별한다.
const credentialId = () => createHash("sha256")
  .update(`${getEnvironment()}:${process.env.KIS_APP_KEY || ""}`)
  .digest("hex");

// 프로세스당 한 번만 디스크 토큰을 읽고 자격정보와 만료시각이 모두 유효할 때 복원한다.
const loadCachedToken = async () => {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const cached = JSON.parse(await readFile(TOKEN_CACHE_PATH, "utf8"));
    if (cached.credentialId === credentialId()
      && typeof cached.accessToken === "string"
      && Number(cached.expiresAt) > Date.now()) {
      accessToken = cached.accessToken;
      expiresAt = Number(cached.expiresAt);
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("KIS 토큰 캐시를 읽지 못했습니다:", error.message);
  }
};

// 재시작 후에도 토큰 발급 API를 반복 호출하지 않도록 권한을 제한한 파일에 저장한다.
const saveCachedToken = async () => {
  try {
    await mkdir(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
    await writeFile(TOKEN_CACHE_PATH, JSON.stringify({
      credentialId: credentialId(),
      accessToken,
      expiresAt,
    }), { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    console.warn("KIS 토큰 캐시를 저장하지 못했습니다:", error.message);
  }
};

const getEnvironment = () => process.env.KIS_ENV === "paper" ? "paper" : "real";
const getBaseUrl = () => KIS_BASE_URLS[getEnvironment()];

// 외부 API 호출 전에 필수 환경변수를 확인해 이해하기 쉬운 오류를 만든다.
const validateConfig = () => {
  if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
    throw new Error("KIS_APP_KEY와 KIS_APP_SECRET을 .env에 설정해야 합니다.");
  }
};

// KIS OAuth 토큰을 발급하고 실제 만료보다 5분 일찍 만료 처리해 경계 시점 오류를 예방한다.
const requestAccessToken = async () => {
  validateConfig();
  const response = await fetch(`${getBaseUrl()}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || data.msg1 || `KIS 토큰 발급 실패 (${response.status})`);
    error.status = 429;
    tokenRetryAt = Date.now() + 60_000;
    error.retryAfter = 60;
    lastTokenError = error;
    throw error;
  }

  const expiresInSeconds = Number(data.expires_in) || 86_400;
  accessToken = data.access_token;
  expiresAt = Date.now() + Math.max(60, expiresInSeconds - 300) * 1000;
  tokenRetryAt = 0;
  lastTokenError = null;
  await saveCachedToken();
  return accessToken;
};

// 동시에 여러 API가 토큰을 요구해도 tokenRequest 하나만 공유해 중복 발급을 방지한다.
const getAccessToken = async () => {
  await loadCachedToken();
  if (accessToken && Date.now() < expiresAt) return accessToken;
  if (lastTokenError && Date.now() < tokenRetryAt) throw lastTokenError;
  if (!tokenRequest) {
    tokenRequest = requestAccessToken().finally(() => {
      tokenRequest = null;
    });
  }
  return tokenRequest;
};

export default { getAccessToken, getBaseUrl, getEnvironment, validateConfig };
