import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const filename = process.argv[2];
if (!filename) throw new Error("적용할 migration 파일 경로가 필요합니다.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL이 설정되지 않았습니다.");

const migrationPath = resolve(filename);
const sql = await readFile(migrationPath, "utf8");
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtext('posco-securities-migrations'))");
  await client.query(sql);
  await client.query("commit");
  console.log(`적용 완료: ${migrationPath}`);
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
