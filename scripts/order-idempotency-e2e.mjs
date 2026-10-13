// Isolated PostgreSQL test. This script never loads .env or connects to an external database.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import("@electric-sql/pglite").catch(() =>
  import("../.cache/brokerage-db-test/node_modules/@electric-sql/pglite/dist/index.js"));
const db = new PGlite();
const query = (sql, values = []) => db.query(sql, values);
const rpc = async (sql, values = []) => (await query(sql, values)).rows[0].result;
const account = async (cash = 2000.30) => (await query("insert into accounts(account_number,krw_balance) values($1,$2) returning id", [`IDEMPOTENCY-${crypto.randomUUID()}`, cash])).rows[0].id;
const market = (accountId, id, quantity = 2, price = 1000) => rpc("select place_spot_order_once($1,'005490','stocks','BUY','MARKET',$2,null,$3,$4) result", [accountId, quantity, price, id]);
const pending = (accountId, id, quantity = 2, price = 1000) => rpc("select create_pending_spot_order_once($1,'005490','stocks','BUY',$2,$3,1,$4) result", [accountId, quantity, price, id]);
const count = async (table, accountId) => Number((await query(`select count(*) n from ${table} where account_id=$1`, [accountId])).rows[0].n);
const request = { kind: "SPOT", symbol: "005490", category: "stocks", side: "BUY", quantity: 2, orderType: "MARKET", price: null };

try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
  const files = (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((name) => name.endsWith(".sql") && name <= "021_order_idempotency.sql").sort();
  for (const name of files) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));

  // A dropped first HTTP response must not consume cash/holdings/fees twice, even after a quote changes.
  const firstAccount = await account();
  const key = crypto.randomUUID();
  const first = await market(firstAccount, key);
  assert.equal(Number(first.account.krw_balance), 0, "cached result must include fee trigger's final balance");
  assert.equal(Number(first.order.fee_amount), 0.30);
  const ledgerBefore = await count("account_ledger", firstAccount);
  assert.deepEqual(await market(firstAccount, key, 2, 1500), first);
  const queued = await Promise.all(Array.from({ length: 6 }, () => market(firstAccount, key, 2, 1800)));
  queued.forEach((result) => assert.deepEqual(result, first));
  assert.equal(await count("orders", firstAccount), 1);
  assert.equal(await count("order_requests", firstAccount), 1);
  assert.equal(await count("account_ledger", firstAccount), ledgerBefore);
  assert.equal(Number((await query("select quantity from holdings where account_id=$1", [firstAccount])).rows[0].quantity), 2);
  assert.deepEqual(await rpc("select get_order_request($1,$2,$3) result", [firstAccount, key, request]), first);
  await assert.rejects(market(firstAccount, key, 3), (error) => error.code === "P4090");
  await assert.rejects(pending(firstAccount, key), (error) => error.code === "P4090");
  await assert.rejects(market(firstAccount, crypto.randomUUID()), /주문가능금액/);
  console.log("PASS lost-response replay, final fee result, changed quote, repeated submission and payload conflict");

  const otherAccount = await account();
  const other = await market(otherAccount, key);
  assert.notEqual(other.order.id, first.order.id, "the same client key in another account must be independent");
  assert.equal(await count("orders", otherAccount), 1);
  assert.equal(await rpc("select get_order_request($1,$2,$3) result", [otherAccount, crypto.randomUUID(), request]), null);
  console.log("PASS account-scoped keys and missing request lookup");

  // Replay a pending request after the original has been cancelled; do not create another reservation.
  const pendingAccount = await account();
  const pendingKey = crypto.randomUUID();
  const accepted = await pending(pendingAccount, pendingKey);
  assert.deepEqual(await pending(pendingAccount, pendingKey), accepted);
  assert.equal(await count("orders", pendingAccount), 1);
  assert.equal(await count("pending_orders", pendingAccount), 1);
  await rpc("select cancel_pending_spot_order($1,$2) result", [pendingAccount, accepted.pending_order.id]);
  assert.deepEqual(await pending(pendingAccount, pendingKey), accepted);
  assert.equal(await count("pending_orders", pendingAccount), 0);
  assert.equal(await count("orders", pendingAccount), 1);
  await assert.rejects(pending(pendingAccount, pendingKey, 2, 1100), (error) => error.code === "P4090");
  console.log("PASS limit acceptance, released reservation and cancelled request replay");

  // Failures roll back the cache and the order together; the same intent can be retried after funding.
  const failedAccount = await account(1);
  const failedKey = crypto.randomUUID();
  await assert.rejects(market(failedAccount, failedKey), /주문가능금액/);
  assert.equal(await count("orders", failedAccount), 0);
  assert.equal(await count("order_requests", failedAccount), 0);
  await query("update accounts set krw_balance=2000.30 where id=$1", [failedAccount]);
  await market(failedAccount, failedKey);
  await assert.rejects(market(failedAccount, null), (error) => error.code === "22023");
  assert.equal(await count("orders", failedAccount), 1);
  console.log("PASS atomic failure rollback, same-key recovery and missing-key rejection");

  const permissions = (await query(`select
    has_function_privilege('anon','place_spot_order_once(bigint,text,text,text,text,numeric,numeric,numeric,uuid)','execute') anon_execute,
    has_function_privilege('authenticated','get_order_request(bigint,uuid,jsonb)','execute') user_lookup,
    has_function_privilege('service_role','place_spot_order_once(bigint,text,text,text,text,numeric,numeric,numeric,uuid)','execute') service_execute,
    has_table_privilege('service_role','order_requests','INSERT') direct_insert`)).rows[0];
  assert.deepEqual(permissions, { anon_execute: false, user_lookup: false, service_execute: true, direct_insert: false });
  await db.exec(await readFile(new URL("../supabase/migrations/021_order_idempotency.sql", import.meta.url), "utf8"));
  assert.deepEqual(await market(firstAccount, key), first);
  console.log("PASS restricted access and repeatable migration");
} finally { await db.close(); }
