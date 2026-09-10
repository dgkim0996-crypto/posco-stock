import { supabase } from "../lib/supabase.js";

const trimTrailingSlashes = (value = "") => String(value).trim().replace(/\/+$/, "");
const apiBaseUrl = trimTrailingSlashes(import.meta.env.VITE_API_BASE_URL);
const configuredWebSocketBaseUrl = trimTrailingSlashes(import.meta.env.VITE_WS_BASE_URL);

const normalizePath = (path) => {
  const value = String(path || "");
  return value.startsWith("/") ? value : `/${value}`;
};

/** 별도 API 주소가 설정되면 절대 URL을, 로컬/Vercel 통합 배포에서는 기존 상대 URL을 만든다. */
export function apiUrl(path) {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;
  return `${apiBaseUrl}${normalizePath(value)}`;
}

/** 명시한 WebSocket 주소 또는 API 주소를 기준으로 실시간 시세 연결 URL을 만든다. */
export function websocketUrl(path) {
  const configuredBase = configuredWebSocketBaseUrl || apiBaseUrl;
  const base = configuredBase
    ? configuredBase.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:")
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  return `${base}${normalizePath(path)}`;
}

export async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("로그인이 필요합니다.");

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(apiUrl(path), { ...options, headers });
}
