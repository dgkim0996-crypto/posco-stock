import { apiUrl } from "../../utils/api.js";

const CLIENT_CACHE_MS = 60 * 1000;
const cache = { articles: null, schedules: null };
const inFlight = { articles: null, schedules: null };

export const peekFeedSection = (kind) => cache[kind]?.payload || null;

export function loadFeedSection(kind, { refresh = false } = {}) {
  if (!Object.hasOwn(cache, kind)) return Promise.reject(new Error("지원하지 않는 피드 종류입니다."));
  const saved = cache[kind];
  if (!refresh && saved && Date.now() - saved.fetchedAt < CLIENT_CACHE_MS) return Promise.resolve(saved.payload);
  if (inFlight[kind]) return inFlight[kind];

  const path = `/api/feed/${kind}${refresh ? "?refresh=1" : ""}`;
  const request = fetch(apiUrl(path))
    .then((response) => {
      if (!response.ok) throw new Error("피드 요청 실패");
      return response.json();
    })
    .then((payload) => {
      cache[kind] = { payload, fetchedAt: Date.now() };
      return payload;
    });
  inFlight[kind] = request.finally(() => { inFlight[kind] = null; });
  return inFlight[kind];
}

export function prefetchInvestmentFeed() {
  void Promise.allSettled([loadFeedSection("articles"), loadFeedSection("schedules")]);
}
