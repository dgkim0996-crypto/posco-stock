import { FAVORITES_MIGRATION_KEY, LEGACY_FAVORITES_STORAGE_KEY } from "../preferences/storageKeys.js";

export function favoritesStorageKey(userId) {
  return `posco-market-favorites-v2:${userId}`;
}

export function loadFavorites(userId) {
  if (typeof window === "undefined") return new Set();
  try {
    const scoped = window.localStorage.getItem(favoritesStorageKey(userId));
    const legacy = !scoped && !window.localStorage.getItem(FAVORITES_MIGRATION_KEY)
      ? window.localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY)
      : null;
    const saved = JSON.parse(scoped || legacy || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}
