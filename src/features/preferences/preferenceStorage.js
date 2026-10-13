import { THEME_STORAGE_KEY, WELCOME_GUIDE_STORAGE_PREFIX } from "./storageKeys.js";

// 사생활 보호 모드·저장공간 초과·차단된 쿠키에서는 localStorage 접근 자체가 예외를 던질 수 있다.
// 저장은 편의 기능이므로 실패해도 화면은 기본값으로 계속 동작하게 한다.
export function readStorage(key) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 삭제 실패는 다음 저장에서 덮어쓰므로 무시한다.
  }
}

export function loadTheme() {
  if (typeof window === "undefined") return "light";
  const saved = readStorage(THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function shouldShowWelcomeGuide(userId) {
  if (typeof window === "undefined") return false;
  return readStorage(`${WELCOME_GUIDE_STORAGE_PREFIX}:${userId}`) !== "dismissed";
}
