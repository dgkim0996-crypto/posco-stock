import { useState, useEffect } from "react";
import { loadFavorites, favoritesStorageKey } from "./favoritesStorage.js";
import { FAVORITES_MIGRATION_KEY } from "../preferences/storageKeys.js";
import { apiFetch } from "../../utils/api.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useFavorites({
  session, setMessage,
}) {
  const [favorites, setFavorites] = useState(() => loadFavorites(session.user.id));

  useEffect(() => {
    window.localStorage.setItem(favoritesStorageKey(session.user.id), JSON.stringify([...favorites]));
    window.localStorage.setItem(FAVORITES_MIGRATION_KEY, "true");
  }, [favorites, session.user.id]);

  useEffect(() => {
    let active = true;

    const loadRemoteFavorites = async () => {
      try {
        const response = await apiFetch("/api/accounts/me/favorites");
        if (!response.ok) throw new Error("즐겨찾기 조회 실패");
        const payload = await response.json();
        if (!active || !Array.isArray(payload.items)) return;

        if (payload.items.length === 0) {
          const localFavorites = [...loadFavorites(session.user.id)];
          if (localFavorites.length > 0) {
            await Promise.all(localFavorites.map((symbol) => apiFetch(
              "/api/accounts/me/favorites",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbol }),
              },
            ).then((result) => {
              if (!result.ok) throw new Error("기존 즐겨찾기 이전 실패");
            })));
          }
          return;
        }

        setFavorites(new Set(payload.items));
      } catch {
        // DB가 일시적으로 응답하지 않으면 브라우저에 저장된 마지막 값으로 계속 동작한다.
      }
    };

    loadRemoteFavorites();
    return () => { active = false; };
  }, [session.user.id]);

  function toggleFavorite(assetId) {
    const removing = favorites.has(assetId);
    const next = new Set(favorites);
    if (removing) next.delete(assetId);
    else next.add(assetId);
    setFavorites(next);

    apiFetch(`/api/accounts/me/favorites${removing ? `/${encodeURIComponent(assetId)}` : ""}`, {
      method: removing ? "DELETE" : "POST",
      headers: removing ? undefined : { "Content-Type": "application/json" },
      body: removing ? undefined : JSON.stringify({ symbol: assetId }),
    }).then((response) => {
      if (!response.ok) throw new Error("즐겨찾기 동기화 실패");
    }).catch(() => {
      setMessage("즐겨찾기는 브라우저에 저장했지만 서버 동기화에 실패했습니다.");
    });
  }

  return {
    favorites, toggleFavorite,
  };
}
