const KIS_BASE_URLS = {
  real: "https://openapi.koreainvestment.com:9443",
  paper: "https://openapivts.koreainvestment.com:29443",
};

let accessToken = null;
let expiresAt = 0;
let tokenRequest = null;
let tokenRetryAt = 0;
let lastTokenError = null;

const getEnvironment = () => process.env.KIS_ENV === "paper" ? "paper" : "real";
const getBaseUrl = () => KIS_BASE_URLS[getEnvironment()];

const validateConfig = () => {
  if (!process.env.KIS_APP_KEY || !process.env.KIS_APP_SECRET) {
    throw new Error("KIS_APP_KEY와 KIS_APP_SECRET을 .env에 설정해야 합니다.");
  }
};

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
    tokenRetryAt = Date.now() + 60_000;
    lastTokenError = error;
    throw error;
  }

  const expiresInSeconds = Number(data.expires_in) || 86_400;
  accessToken = data.access_token;
  expiresAt = Date.now() + Math.max(60, expiresInSeconds - 300) * 1000;
  tokenRetryAt = 0;
  lastTokenError = null;
  return accessToken;
};

const getAccessToken = async () => {
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
