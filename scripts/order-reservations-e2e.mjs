// Isolated PostgreSQL regression: no .env, external connection or production writes.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { INITIAL_MARKETS } from "../src/data/markets.js";
import { estimateTradeTaxes } from "../src/utils/tradeTaxes.js";

const { PGlite } = await import("@electric-sql/pglite").catch(() =>
  import("../.cache/brokerage-db-test/node_modules/@electric-sql/pglite/dist/index.js"));
const db = new PGlite();
const rpc = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.result;
const query = (sql, params = []) => db.query(sql, params);
const reject = async (sql, params, pattern) => assert.rejects(query(sql, params), (error) => pattern.test(error.message));
const account = async (cash = 10000) => (await query("insert into accounts(account_number,krw_balance) values($1,$2) returning id", [`OFFLINE-${crypto.randomUUID()}`, cash])).rows[0].id;
const pending = (id, symbol = "005490", side = "BUY", quantity = 5, price = 1000, category = "stocks") =>
  rpc("select create_pending_spot_order($1,$2,$3,$4,$5,$6,0.01) result", [id, symbol, category, side, quantity, price]);

try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
  const files = (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));

  // Reuse the established SQL flow tests against this isolated database.
  for (const name of ["partial-fill-e2e.mjs", "trade-settlement-e2e.mjs", "margin-risk-e2e.mjs"]) {
    const source = (await readFile(new URL(name, import.meta.url), "utf8"))
      .replace(/import\s*"dotenv\/config"\s*;/g, "").replace(/import\s+pg\s+from\s*"pg"\s*;/g, "");
    class Client { async connect() {} query(...args) { return db.query(...args); } async end() {} }
    await new (Object.getPrototypeOf(async function () {}).constructor)("pg", "console", source)({ Client }, { log() {} });
    console.log(`PASS existing ${name}`);
  }

  const a = await account();
  const first = await pending(a);
  assert.equal(Number(first.pending_order.reserved_amount), 5000.75, "fees must be reserved by DB even when client sends 0.01");
  await reject("select create_pending_spot_order($1,'005490','stocks','BUY',5,1000,1)", [a], /주문가능금액/);
  await reject("select place_spot_order($1,'005490','stocks','BUY','MARKET',5,null,1000)", [a], /주문가능금액/);
  await reject("update accounts set krw_balance=4999 where id=$1", [a], /예약금/);
  await reject("select amend_pending_spot_order($1,$2,10,1000,1)", [a, first.pending_order.id], /주문가능금액/);
  await reject("select place_pending_spot_order($1,$2,1001,1)", [a, first.pending_order.id], /지정가/);
  await reject("select place_pending_spot_order($1,$2,1000,0.5)", [a, first.pending_order.id], /정수/);
  const partial = await rpc("select place_pending_spot_order($1,$2,900,2) result", [a, first.pending_order.id]);
  assert.equal(Number(partial.order.filled_quantity), 2);
  const remainder = (await query("select * from pending_orders where id=$1", [first.pending_order.id])).rows[0];
  assert.equal(Number(remainder.reserved_amount), 3000.45);
  assert.equal(Number((await query("select krw_balance from accounts where id=$1", [a])).rows[0].krw_balance), 8199.73);
  await rpc("select amend_pending_spot_order($1,$2,3,950,1) result", [a, first.pending_order.id]);
  const events = (await query("select event_type from order_events where order_id=$1 order by id", [first.order.id])).rows.map((row) => row.event_type);
  assert.deepEqual(events, ["ACCEPTED", "OPEN", "PARTIALLY_FILLED", "AMENDED"]);
  await rpc("select cancel_pending_spot_order($1,$2) result", [a, first.pending_order.id]);
  await query("update accounts set krw_balance=0 where id=$1", [a]);
  await reject("select place_pending_spot_order($1,$2,900,1)", [a, first.pending_order.id], /찾을 수/);
  console.log("PASS cash reservation, partial fill, price amendment, cancellation and cash release");

  const b = await account();
  await query("insert into holdings(account_id,symbol,category,quantity,avg_price) values($1,'005490','stocks',10,1000)", [b]);
  const sell = await pending(b, "005490", "SELL", 7, 1000);
  assert.equal(Number(sell.pending_order.reserved_amount), 0);
  await reject("select create_pending_spot_order($1,'005490','stocks','SELL',4,1000,1)", [b], /매도가능/);
  await reject("select place_spot_order($1,'005490','stocks','SELL','MARKET',4,null,1000)", [b], /매도가능/);
  await rpc("select place_spot_order($1,'005490','stocks','SELL','MARKET',3,null,1000) result", [b]);
  await rpc("select place_pending_spot_order($1,$2,1100) result", [b, sell.pending_order.id]);
  assert.equal((await query("select * from holdings where account_id=$1", [b])).rows.length, 0);
  console.log("PASS sell inventory reservation, direct market sale and legacy overload removal");

  const c = await account();
  await query("insert into finance_contracts(account_id,product_type,active,limit_amount) values($1,'lending',true,5000)", [c]);
  const short = await pending(c, "005490", "SELL", 4, 1000);
  await reject("select create_pending_spot_order($1,'005930','stocks','SELL',2,1000,1)", [c], /대주한도/);
  await rpc("select place_pending_spot_order($1,$2,1000,2) result", [c, short.pending_order.id]);
  await reject("select place_spot_order($1,'005930','stocks','SELL','MARKET',2,null,1000)", [c], /대주한도/);
  await rpc("select cancel_pending_spot_order($1,$2) result", [c, short.pending_order.id]);
  await rpc("select place_spot_order($1,'005930','stocks','SELL','MARKET',2,null,1000) result", [c]);
  console.log("PASS short lending usage and pending reservations share one limit");

  const matchingAccount = await account();
  const matchingOrder = await pending(matchingAccount, "005490", "BUY", 5, 1000);
  const quoteAt = new Date().toISOString();
  const match = (quantity, observed, limit, at = quoteAt) => rpc("select match_pending_spot_order($1,$2,900,$3,$4,$5,$6) result", [matchingAccount, matchingOrder.pending_order.id, quantity, observed, limit, at]);
  assert.equal((await match(2, 5, 1000)).matched, true);
  assert.equal((await match(2, 5, 1000)).reason, "changed", "concurrent stale snapshot cannot double-fill");
  assert.equal((await match(1, 3, 1000)).reason, "stale_quote", "a quote may only fill each order once");
  await rpc("select amend_pending_spot_order($1,$2,2,950,1) result", [matchingAccount, matchingOrder.pending_order.id]);
  assert.equal((await match(1, 3, 1000)).reason, "changed");
  assert.equal((await match(1, 2, 950, new Date(Date.now() - 180000).toISOString())).reason, "stale_quote");
  assert.equal((await match(1, 2, 950, new Date(Date.now() + 1000).toISOString())).matched, true);
  await rpc("select cancel_pending_spot_order($1,$2) result", [matchingAccount, matchingOrder.pending_order.id]);
  assert.equal((await match(1, 1, 950)).reason, "removed");
  const matchingResult = (await query("select * from orders where id=$1", [matchingOrder.order.id])).rows[0];
  assert.equal(Number(matchingResult.filled_quantity), 3);
  assert.equal(Number(matchingResult.cancelled_quantity), 1);
  console.log("PASS server matching, duplicate quote, concurrent snapshot, stale quote, amendment and cancellation races");

  // 345.60달러 지정가는 476928.00000000으로 저장된다. 미반올림 부동소수 체결가도 같은 가격으로 교차해야 한다.
  const usdBuyer = await account(2_000_000);
  const usdBuy = await pending(usdBuyer, "AAPL", "BUY", 2, 476928);
  const usdMatch = await rpc("select match_pending_spot_order($1,$2,$3::numeric,1,2,476928,$4) result",
    [usdBuyer, usdBuy.pending_order.id, "476928.00000000006", new Date().toISOString()]);
  assert.equal(usdMatch.matched, true, "float noise above an equal BUY limit must not be not_crossed");
  assert.equal(Number((await query("select execution_price from order_quote_matches where order_id=$1", [usdBuy.order.id])).rows[0].execution_price), 476928);
  assert.equal((await rpc("select match_pending_spot_order($1,$2,476928.01,1,1,476928,$3) result",
    [usdBuyer, usdBuy.pending_order.id, new Date(Date.now() + 1000).toISOString()])).reason, "not_crossed");
  const usdSeller = await account(100_000);
  await query("insert into holdings(account_id,symbol,category,quantity,avg_price) values($1,'AAPL','stocks',2,400000)", [usdSeller]);
  const usdSell = await pending(usdSeller, "AAPL", "SELL", 2, 476928);
  const usdSold = await rpc("select place_pending_spot_order($1,$2,$3::numeric,1) result", [usdSeller, usdSell.pending_order.id, "476927.99999999994"]);
  assert.equal(Number(usdSold.order.filled_quantity), 1, "float noise below an equal SELL limit must still fill");
  console.log("PASS USD limit prices compare at the stored 8-digit precision");

  // 정정 창을 연 뒤 부분체결되면 화면의 잔량(5)과 DB 잔량(3)이 달라 총주문수량을 늘리지 않고 거부한다.
  const amendAccount = await account();
  const amendTarget = await pending(amendAccount, "005490", "BUY", 5, 1000);
  await rpc("select place_pending_spot_order($1,$2,1000,2) result", [amendAccount, amendTarget.pending_order.id]);
  await reject("select amend_pending_spot_order($1,$2,5,1000,1,5)", [amendAccount, amendTarget.pending_order.id], /잔여수량이 바뀌었습니다/);
  await assert.rejects(query("select amend_pending_spot_order($1,$2,5,1000,1,5)", [amendAccount, amendTarget.pending_order.id]), (error) => error.code === "P4090");
  const orderQuantities = async () => Object.values((await query("select quantity,filled_quantity,remaining_quantity from orders where id=$1", [amendTarget.order.id])).rows[0]).map(Number);
  assert.deepEqual(await orderQuantities(), [5, 2, 3], "a rejected stale amendment must not grow the order");
  await reject("select amend_pending_spot_order($1,$2,3,950,1,0)", [amendAccount, amendTarget.pending_order.id], /기준 잔여수량/);
  const amended = await rpc("select amend_pending_spot_order($1,$2,3,950,1,3) result", [amendAccount, amendTarget.pending_order.id]);
  assert.equal(Number(amended.pending_order.limit_price), 950);
  assert.deepEqual(await orderQuantities(), [5, 2, 3]);
  await reject("select amend_pending_spot_order($1,$2,3,950,1,3)", [amendAccount, crypto.randomUUID()], /찾을 수/);
  const amendPermissions = (await query(`select
    has_function_privilege('service_role','amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric)','execute') service_execute,
    has_function_privilege('authenticated','amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric)','execute') user_execute,
    has_function_privilege('anon','amend_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric)','execute') anon_execute,
    has_function_privilege('authenticated','match_pending_spot_order(bigint,uuid,numeric,numeric,numeric,numeric,timestamptz)','execute') user_match`)).rows[0];
  assert.deepEqual(amendPermissions, { service_execute: true, user_execute: false, anon_execute: false, user_match: false });
  console.log("PASS amendment compares the remaining quantity seen by the user under lock");

  // 합성 원화 ETF는 화면(tradeTaxes.js)과 같은 국내 ETF 수수료로 예약·부과한다(해외주식 0.07% 아님).
  const sh10x = INITIAL_MARKETS.stocks.find((asset) => asset.symbol === "SH10X");
  const screenBuy = estimateTradeTaxes({ category: "stocks", asset: sh10x, side: "BUY", priceKrw: 10000, quantity: 3 });
  const screenSell = estimateTradeTaxes({ category: "stocks", asset: sh10x, side: "SELL", priceKrw: 10000, quantity: 3 });
  assert.equal(Number(await rpc("select spot_buy_reservation('SH10X','stocks',3,10000) result")), -screenBuy.settlementAmount);
  const etfAccount = await account(100_000);
  const etfCharges = async (result) => Object.values((await query("select fee_amount,tax_amount from orders where id=$1", [result.order.id])).rows[0]).map(Number);
  assert.deepEqual(await etfCharges(await rpc("select place_spot_order($1,'SH10X','stocks','BUY','MARKET',3,null,10000) result", [etfAccount])), [screenBuy.feeAmount, 0]);
  assert.deepEqual(await etfCharges(await rpc("select place_spot_order($1,'SH10X','stocks','SELL','MARKET',3,null,10000) result", [etfAccount])), [screenSell.feeAmount, screenSell.immediateTaxAmount]);
  console.log("PASS SH10X fee policy matches the order screen");

  for (const q of ["NaN", "Infinity", "-Infinity", "-1", "0", "0.123456789"]) {
    await reject("select create_pending_spot_order($1,'BTC','crypto','BUY',$2::numeric,1000,1)", [b, q], /수량/);
  }
  const permissions = (await query("select has_function_privilege('service_role','place_spot_order_unreserved_v019(bigint,text,text,text,text,numeric,numeric,numeric)','execute') allowed")).rows[0];
  assert.equal(permissions.allowed, false);
  await db.exec(await readFile(new URL("../supabase/migrations/020_atomic_order_reservations.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../supabase/migrations/023_spot_order_precision_and_amend_guard.sql", import.meta.url), "utf8"));
  assert.equal(Number((await query("select count(*) n from trade_charge_overrides where symbol='SH10X'")).rows[0].n), 1);
  console.log(`PASS invalid numerics, restricted internals and idempotent migration (${files.length} migrations)`);
} finally { await db.close(); }
