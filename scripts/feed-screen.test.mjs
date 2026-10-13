import test from "node:test";
import assert from "node:assert/strict";
import { mountTradingApp } from "./fixtures/trading-app-harness.mjs";

test("feed screen requests news and schedules independently", async () => {
  const app = await mountTradingApp();
  try {
    await app.click(app.button("먼저 둘러볼게요"));
    await app.click(app.button("피드"));
    assert.match(app.container.textContent, /오늘의 시장 기사/);
    assert.ok(app.calls.some((call) => call.url === "/api/feed/articles"));
    assert.ok(app.calls.some((call) => call.url === "/api/feed/schedules"));
    assert.equal(app.calls.some((call) => call.url === "/api/feed"), false);
  } finally {
    await app.close();
  }
});
