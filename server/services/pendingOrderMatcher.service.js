import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabase.js";
import { executionQuoteFor } from "./orders.service.js";
import alternativeMarketDataService from "./alternativeMarketData.service.js";
import { accountIdOf, assertLimitCrossed, bindPendingOrder } from "./spotOrderValidation.js";

// 실제 거래소 체결량을 흉내내는 명시적 모의정책: 새로운 시세마다 잔량의 40%.
// 한 시세의 중복 사용과 정정/취소 경합은 DB compare-and-match에서 최종 차단한다.
export function simulatedFillQuantity(quantity, category) {
  const precision = category === "crypto" ? 100_000_000 : 1;
  const units = Math.round(Number(quantity) * precision);
  return Math.min(units, Math.max(1, Math.floor(units * 0.4))) / precision;
}

export function createPendingMatcher({ database = getSupabaseAdmin,
  quoteFor = (input) => executionQuoteFor(input, undefined, undefined, { refresh: false }),
  now = Date.now, maxOrders = 20, budgetMs = 1500 } = {}) {
  const cursors = new Map();
  const running = new Map();
  const recent = new Map();
  let lastStatus = { status: "idle", checked: 0, matched: 0 };

  async function pass(accountId) {
    const key = accountId == null ? "all" : String(accountId);
    if (running.has(key)) return running.get(key);
    const previous = recent.get(key);
    if (previous && now() - previous.at < 4000) return { ...previous.result, throttled: true };
    const task = (async () => {
      const started = now();
      const db = database();
      let query = db.from("pending_orders").select("*").order("id", { ascending: true }).limit(maxOrders);
      if (accountId != null) query = query.eq("account_id", accountId);
      const cursor = cursors.get(key);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query;
      if (error) throw new Error(`미체결 자동체결 조회 실패: ${error.message}`);
      const result = { status: "ok", checked: 0, matched: 0, deferred: 0, failures: 0 };
      for (const row of data) {
        if (result.checked > 0 && now() - started >= budgetMs) break;
        cursors.set(key, row.id);
        result.checked += 1;
        try {
          const input = bindPendingOrder({ accountId: Number(row.account_id), pendingOrderId: row.id }, row);
          const quote = await quoteFor(input);
          assertLimitCrossed(input, quote.price);
          const { data: matched, error: matchError } = await db.rpc("match_pending_spot_order", {
            p_account_id: input.accountId, p_pending_order_id: row.id, p_execution_price: quote.price,
            p_fill_quantity: simulatedFillQuantity(input.quantity, input.asset.category),
            p_observed_quantity: input.quantity, p_observed_limit_price: Number(row.limit_price), p_quote_updated_at: quote.updatedAt,
          });
          if (matchError) throw Object.assign(new Error(matchError.message), { status: matchError.code === "P0001" ? 400 : 503 });
          if (matched?.matched) result.matched += 1;
          else result.deferred += 1;
        } catch (error) {
          if ([400, 404, 409].includes(error.status) || /시세/.test(error.message)) result.deferred += 1;
          else { result.failures += 1; result.error = error.message; }
        }
      }
      // UUID cursor keeps an unexecutable oldest order from starving later orders.
      if (result.checked === data.length && data.length < maxOrders) cursors.delete(key);
      if (result.failures) result.status = "degraded";
      lastStatus = { ...result, updatedAt: new Date(now()).toISOString() };
      recent.set(key, { at: now(), result: lastStatus });
      if (recent.size > 1000) { const oldest = recent.keys().next().value; recent.delete(oldest); cursors.delete(oldest); }
      return lastStatus;
    })().catch((error) => {
      lastStatus = { status: "degraded", checked: 0, matched: 0, error: error.message, updatedAt: new Date(now()).toISOString() };
      recent.set(key, { at: now(), result: lastStatus });
      return lastStatus;
    }).finally(() => running.delete(key));
    running.set(key, task);
    return task;
  }
  return { runAll: () => pass(null), runForAccount: (id) => pass(accountIdOf(id)), getStatus: () => lastStatus };
}

const matcher = createPendingMatcher();
let timer = null;
let stopped = true;
let lastAlternativeRefresh = 0;
const tick = async () => {
  try {
    // Alternative-market quotes also continue updating after the browser closes.
    if (Date.now() - lastAlternativeRefresh >= 30_000) {
      lastAlternativeRefresh = Date.now();
      const { data } = await getSupabaseAdmin().from("pending_orders").select("id").in("category", ["bonds", "crypto"]).limit(1);
      if (data?.length) await alternativeMarketDataService.loadQuotes().catch(() => undefined);
    }
    await matcher.runAll();
  } catch (error) {
    console.error("미체결 자동체결 주기 실패:", error.message);
  } finally {
    if (!stopped) { timer = setTimeout(tick, 5000); timer.unref(); }
  }
};
const start = () => { if (!stopped || !isSupabaseEnabled()) return; stopped = false; tick().catch(() => undefined); };
const stop = () => { stopped = true; if (timer) clearTimeout(timer); timer = null; };
export default { ...matcher, start, stop };
