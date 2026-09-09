// 외부 공개 피드에서 실제 금융 기사와 예정된 실적 발표 일정을 모아 프론트에 전달한다.
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 7000;
let cachedFeed = null;
let cachedAt = 0;

const decodeEntities = (value = "") => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).trim();
const readTag = (xml, tag) => decodeEntities(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`외부 피드 응답 오류 (${response.status})`);
    return response;
  } finally { clearTimeout(timeout); }
};

const loadArticles = async () => {
  const query = encodeURIComponent("한국 증시 OR 코스피 OR 반도체 OR 2차전지 when:2d");
  const xml = await (await fetchWithTimeout(`https://news.google.com/rss/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`, { headers: { "User-Agent": "Mozilla/5.0 POSCO-Securities-Learning-App" } })).text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((match) => {
    const item = match[1];
    const publishedAt = readTag(item, "pubDate");
    return { title: readTag(item, "title"), url: readTag(item, "link"), source: readTag(item, "source") || "Google 뉴스", publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null, category: "뉴스" };
  }).filter((item) => item.title && item.url);
};

const formatDate = (date) => date.toISOString().slice(0, 10);
const nextWeekdays = (count) => {
  const dates = []; const cursor = new Date(); cursor.setHours(12, 0, 0, 0);
  while (dates.length < count) { if (cursor.getDay() !== 0 && cursor.getDay() !== 6) dates.push(formatDate(cursor)); cursor.setDate(cursor.getDate() + 1); }
  return dates;
};
const marketCapNumber = (value) => Number(String(value || "0").replace(/[$,]/g, "")) || 0;

const loadSchedules = async () => {
  const results = await Promise.allSettled(nextWeekdays(7).map(async (date) => {
    const response = await fetchWithTimeout(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, { headers: { Accept: "application/json, text/plain, */*", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8", "User-Agent": "Mozilla/5.0 POSCO-Securities-Learning-App" } });
    const payload = await response.json();
    return (payload?.data?.rows || []).map((row) => ({ ...row, date }));
  }));
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []).sort((a, b) => marketCapNumber(b.marketCap) - marketCapNumber(a.marketCap)).slice(0, 8).map((row) => ({
    date: row.date, title: `${row.name || row.symbol} 실적 발표`, description: `${row.symbol} · ${row.time || "발표 시각 미정"}${row.epsForecast ? ` · EPS 예상 ${row.epsForecast}` : ""}`, source: "Nasdaq Earnings Calendar", url: `https://www.nasdaq.com/market-activity/stocks/${String(row.symbol).toLowerCase()}/earnings`,
  }));
};

const loadFeed = async ({ force = false } = {}) => {
  if (!force && cachedFeed && Date.now() - cachedAt < CACHE_TTL_MS) return cachedFeed;
  const [articlesResult, schedulesResult] = await Promise.allSettled([loadArticles(), loadSchedules()]);
  const nextFeed = { articles: articlesResult.status === "fulfilled" ? articlesResult.value : cachedFeed?.articles || [], schedules: schedulesResult.status === "fulfilled" ? schedulesResult.value : cachedFeed?.schedules || [], updatedAt: new Date().toISOString(), errors: [articlesResult.status === "rejected" ? `뉴스: ${articlesResult.reason.message}` : null, schedulesResult.status === "rejected" ? `일정: ${schedulesResult.reason.message}` : null].filter(Boolean) };
  if (!nextFeed.articles.length && !nextFeed.schedules.length && cachedFeed) return cachedFeed;
  cachedFeed = nextFeed; cachedAt = Date.now(); return nextFeed;
};

export default { loadFeed };
