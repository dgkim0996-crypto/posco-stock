import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const testDirectory = await mkdtemp(path.join(tmpdir(), "posco-feed-test-"));
process.chdir(testDirectory);

const article = (title, id, source = "테스트 뉴스", url = `https://news.google.com/rss/articles/${id}`) => `<item><title>${title}</title><link>${url}</link><source>${source}</source><pubDate>Mon, 28 Sep 2026 00:00:00 GMT</pubDate></item>`;
const rss = (items) => `<rss><channel>${items.join("")}</channel></rss>`;
const firstNews = rss([
  article("첫 기사", "first"),
  article("읽을 수 없는 기사", "blocked-ko", "조선비즈"),
  article("영문 출처 기사", "blocked-en", "ChosunBiz"),
  article("다른 조선 기사", "allowed", "조선일보"),
]);
const secondNews = rss([
  article("새 기사", "second"),
  article("직접 주소 기사", "blocked-url", "테스트 뉴스", "https://biz.chosun.com/article"),
  article("출처가 제목에만 있는 기사 - 조선비즈", "blocked-title", "Google 뉴스"),
]);
let articleRequests = 0;
let scheduleRequests = 0;
let completeRefresh;

globalThis.fetch = async (url) => {
  if (String(url).includes("news.google.com/rss/search")) {
    articleRequests += 1;
    if (articleRequests === 2) return new Promise((resolve) => { completeRefresh = () => resolve(new Response(secondNews)); });
    return new Response(firstNews);
  }
  if (String(url).includes("api.nasdaq.com")) {
    scheduleRequests += 1;
    return new Response(JSON.stringify({ data: { rows: [] } }), { headers: { "Content-Type": "application/json" } });
  }
  throw new Error(`예상하지 못한 외부 요청: ${url}`);
};

const { default: feedService } = await import("../server/services/investmentFeed.service.js");

test("news loads without waiting for the seven Nasdaq schedule requests", async () => {
  const result = await feedService.loadFeedKind("articles");
  assert.equal(result.items[0].title, "첫 기사");
  assert.deepEqual(result.items.map((item) => item.source), ["테스트 뉴스", "조선일보"]);
  assert.equal(articleRequests, 1);
  assert.equal(scheduleRequests, 0);
});

test("stale news returns immediately and concurrent refreshes share one request", async () => {
  const originalNow = Date.now;
  Date.now = () => originalNow() + 11 * 60 * 1000;
  try {
    const stale = await feedService.loadFeedKind("articles");
    assert.equal(stale.items[0].title, "첫 기사");
    assert.equal(stale.stale, true);
    assert.equal(articleRequests, 2);

    const updated = feedService.loadFeedKind("articles", { force: true });
    const another = feedService.loadFeedKind("articles", { force: true });
    assert.equal(articleRequests, 2);
    completeRefresh();
    const [first, second] = await Promise.all([updated, another]);
    assert.equal(first.items[0].title, "새 기사");
    assert.equal(first.items.some((item) => item.title.includes("조선비즈") || item.url.includes("biz.chosun.com")), false);
    assert.deepEqual(first.items, second.items);
  } finally {
    Date.now = originalNow;
  }
});

test("restored news cache excludes ChosunBiz before any new RSS request", async () => {
  const { default: database } = await import("../server/services/marketDatabase.service.js");
  database.saveFeedItems("articles", [
    { title: "저장된 조선비즈 기사", url: "https://news.google.com/rss/articles/old-blocked", source: "조선비즈", publishedAt: "2026-09-28T00:00:00Z" },
    { title: "저장된 정상 기사", url: "https://news.google.com/rss/articles/old-allowed", source: "테스트 뉴스", publishedAt: "2026-09-28T00:00:00Z" },
  ]);
  const { default: restoredService } = await import("../server/services/investmentFeed.service.js?restored-cache-test");
  const requestsBefore = articleRequests;
  const restored = await restoredService.loadFeedKind("articles");
  assert.deepEqual(restored.items.map((item) => item.title), ["저장된 정상 기사"]);
  assert.equal(articleRequests, requestsBefore);
});

test("a cache containing only ChosunBiz triggers a fresh news request", async () => {
  const { default: database } = await import("../server/services/marketDatabase.service.js");
  database.saveFeedItems("articles", [
    { title: "차단된 기사", url: "https://news.google.com/rss/articles/only-blocked", source: "조선비즈", publishedAt: "2026-09-28T00:00:00Z" },
  ]);
  const { default: restoredService } = await import("../server/services/investmentFeed.service.js?blocked-only-test");
  const requestsBefore = articleRequests;
  const restored = await restoredService.loadFeedKind("articles");
  assert.equal(articleRequests, requestsBefore + 1);
  assert.equal(restored.items.some((item) => item.source === "조선비즈"), false);
});
