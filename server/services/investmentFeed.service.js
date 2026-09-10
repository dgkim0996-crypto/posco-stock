// 외부 공개 피드에서 실제 금융 기사와 예정된 실적 발표 일정을 모아 프론트에 전달한다.
import marketDatabaseService from "./marketDatabase.service.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 7000;
const FEED_LIMIT = 30;
const restoredArticles = marketDatabaseService.loadFeedItems("articles");
const restoredSchedules = marketDatabaseService.loadFeedItems("schedules");
const restoredUpdatedAt = [restoredArticles.updatedAt, restoredSchedules.updatedAt].filter(Boolean).sort().at(-1) || null;
let cachedFeed = restoredArticles.items.length || restoredSchedules.items.length
  ? { articles: restoredArticles.items, schedules: restoredSchedules.items, updatedAt: restoredUpdatedAt, errors: [] }
  : null;
let cachedAt = 0;
// 같은 기사를 반복해서 열 때 언론사 페이지를 다시 파싱하지 않도록 본문도 캐시한다.
const articleCache = new Map();
let articleParserPromise = null;

// 기사 본문 파서가 다른 API의 서버 시작을 막지 않도록 실제 기사 요청 시에만 로드한다.
const loadArticleParser = () => {
  if (!articleParserPromise) {
    articleParserPromise = Promise.all([
      import("@mozilla/readability"),
      import("jsdom"),
    ]).then(([readabilityModule, jsdomModule]) => ({
      Readability: readabilityModule.Readability,
      JSDOM: jsdomModule.JSDOM,
    }));
  }
  return articleParserPromise;
};

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
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, FEED_LIMIT * 2).map((match) => {
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
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []).sort((a, b) => a.date.localeCompare(b.date) || marketCapNumber(b.marketCap) - marketCapNumber(a.marketCap)).slice(0, FEED_LIMIT * 2).map((row) => ({
    date: row.date, symbol:row.symbol, title: `${row.name || row.symbol} 실적 발표`, description: `${row.symbol} · ${row.time || "발표 시각 미정"}${row.epsForecast ? ` · EPS 예상 ${row.epsForecast}` : ""}`, source: "Nasdaq Earnings Calendar", url: `https://www.nasdaq.com/market-activity/stocks/${String(row.symbol).toLowerCase()}/earnings`,
  }));
};

const articleTime = (item) => {
  const value = new Date(item.publishedAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
};

// 새 항목을 우선 병합하고 중복을 제거한 뒤 가장 오래된 기사부터 30개 밖으로 밀어낸다.
const mergeArticles = (freshItems, savedItems = []) => {
  const unique = new Map();
  for (const item of [...freshItems, ...savedItems]) {
    const key = String(item.url || item.title || "");
    if (key && !unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => articleTime(b) - articleTime(a)).slice(0, FEED_LIMIT);
};

// 지난 일정은 제거하고 가까운 발표일 순으로 30개만 남겨 새 일정이 자연스럽게 순환되게 한다.
const mergeSchedules = (freshItems, savedItems = []) => {
  const today = formatDate(new Date());
  const unique = new Map();
  for (const item of [...freshItems, ...savedItems]) {
    const key = `${item.date || ""}|${item.symbol || item.title || ""}`;
    if (item.date >= today && key !== "|" && !unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)).slice(0, FEED_LIMIT);
};

const saveRollingFeed = (articles, schedules) => {
  try {
    marketDatabaseService.saveFeedItems("articles", articles);
    marketDatabaseService.saveFeedItems("schedules", schedules);
  } catch (error) {
    console.warn("투자 피드 캐시 저장 실패:", error.message);
  }
};

const loadFeed = async ({ force = false } = {}) => {
  if (!force && cachedFeed && Date.now() - cachedAt < CACHE_TTL_MS) return cachedFeed;
  const [articlesResult, schedulesResult] = await Promise.allSettled([loadArticles(), loadSchedules()]);
  const articles = articlesResult.status === "fulfilled" ? mergeArticles(articlesResult.value, cachedFeed?.articles) : cachedFeed?.articles || [];
  const schedules = schedulesResult.status === "fulfilled" ? mergeSchedules(schedulesResult.value, cachedFeed?.schedules) : cachedFeed?.schedules || [];
  const refreshed = articlesResult.status === "fulfilled" || schedulesResult.status === "fulfilled";
  const nextFeed = { articles, schedules, updatedAt: refreshed ? new Date().toISOString() : cachedFeed?.updatedAt || null, errors: [articlesResult.status === "rejected" ? `뉴스: ${articlesResult.reason.message}` : null, schedulesResult.status === "rejected" ? `일정: ${schedulesResult.reason.message}` : null].filter(Boolean) };
  if (!nextFeed.articles.length && !nextFeed.schedules.length && cachedFeed) return cachedFeed;
  saveRollingFeed(nextFeed.articles, nextFeed.schedules);
  const activeArticleUrls = new Set(nextFeed.articles.map((item) => item.url));
  for (const url of articleCache.keys()) if (!activeArticleUrls.has(url)) articleCache.delete(url);
  cachedFeed = nextFeed; cachedAt = Date.now(); return nextFeed;
};

// Google 뉴스 RSS의 중계 주소를 실제 언론사 기사 주소로 해석한다.
const resolveGoogleNewsUrl = async (googleUrl) => {
  const parsed = new URL(googleUrl);
  const articleId = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!articleId || parsed.hostname !== "news.google.com") return googleUrl;

  const page = await (await fetchWithTimeout(googleUrl, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
  const node = page.match(new RegExp(`<[^>]+data-n-a-id="${articleId}"[^>]*>`, "i"))?.[0];
  const signature = node?.match(/data-n-a-sg="([^"]+)"/i)?.[1];
  const timestamp = node?.match(/data-n-a-ts="([^"]+)"/i)?.[1];
  if (!signature || !timestamp) throw Object.assign(new Error("뉴스 원문 주소를 확인하지 못했습니다."), { status: 502 });

  const request = ["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "KR:ko", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], articleId, Number(timestamp), signature];
  const body = new URLSearchParams({ "f.req": JSON.stringify([[['Fbv4je', JSON.stringify(request)]]]) });
  const response = await fetchWithTimeout("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "Mozilla/5.0" }, body,
  });
  const responseText = await response.text();
  const envelope = responseText.split("\n\n").map((part) => part.trim()).find((part) => part.startsWith("[["));
  const decoded = envelope ? JSON.parse(JSON.parse(envelope)[0][2]) : null;
  const resolvedUrl = decoded?.[1];
  if (typeof resolvedUrl !== "string" || !resolvedUrl.startsWith("https://")) throw Object.assign(new Error("뉴스 원문 주소를 확인하지 못했습니다."), { status: 502 });
  return resolvedUrl;
};

// Readability 결과에서 광고·고지 문구를 제외하고 모달에 표시할 본문 문단만 추린다.
const extractArticleParagraphs = async (html, url) => {
  const { Readability, JSDOM } = await loadArticleParser();
  const document = new JSDOM(html, { url }).window.document;
  const article = new Readability(document).parse();
  if (!article?.content) return [];
  const articleDocument = new JSDOM(`<main>${article.content}</main>`).window.document;
  let paragraphs = [...articleDocument.querySelectorAll("p")].map((node) => node.textContent.replace(/\s+/g, " ").trim());
  if (!paragraphs.some((text) => text.length >= 35)) paragraphs = String(article.textContent || "").split(/\n+/).map((text) => text.replace(/\s+/g, " ").trim());
  return [...new Set(paragraphs)]
    .filter((text) => text.length >= 35 && !/(기사 읽어주기|브라우저가 .*태그를 지원|쿠키|개인정보|무단 전재|재배포 금지|copyright|all rights reserved)/i.test(text))
    .slice(0, 30);
};

// 임의 URL 프록시가 되지 않도록 현재 서버 피드에 존재하는 기사만 허용한다.
const loadArticle = async (url) => {
  const feed = await loadFeed();
  const article = feed.articles.find((item) => item.url === url);
  if (!article) throw Object.assign(new Error("현재 피드에 없는 뉴스입니다."), { status: 404 });
  const saved = articleCache.get(url);
  if (saved && Date.now() - saved.cachedAt < CACHE_TTL_MS) return saved.payload;

  const resolvedUrl = await resolveGoogleNewsUrl(article.url);
  const resolved = new URL(resolvedUrl);
  if (resolved.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(resolved.hostname)) throw Object.assign(new Error("허용되지 않은 뉴스 주소입니다."), { status: 400 });
  const response = await fetchWithTimeout(resolvedUrl, { headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" } });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) throw Object.assign(new Error("본문 형식을 읽을 수 없습니다."), { status: 502 });
  const html = await response.text();
  const paragraphs = await extractArticleParagraphs(html, resolvedUrl);
  if (!paragraphs.length) throw Object.assign(new Error("언론사에서 본문 제공을 제한하고 있습니다."), { status: 502 });
  const payload = { title: article.title, source: article.source, publishedAt: article.publishedAt, paragraphs };
  articleCache.set(url, { cachedAt: Date.now(), payload });
  return payload;
};

export default { loadArticle, loadFeed };
