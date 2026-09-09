import "dotenv/config";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const { rows } = await client.query(`
    select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('place_pending_spot_order', 'amend_pending_spot_order', 'cancel_pending_spot_order')
    order by p.proname, arguments
  `);
  const partial = rows.some((row) => row.proname === "place_pending_spot_order"
    && row.arguments.includes("p_fill_quantity numeric"));
  if (!partial) throw new Error("부분체결 함수의 4개 인자 버전을 찾지 못했습니다.");
  console.log("검증 완료: 부분체결·정정·취소 함수가 public 스키마에 존재합니다.");
  for (const row of rows) console.log(`${row.proname}(${row.arguments})`);
} finally {
  await client.end().catch(() => undefined);
}
