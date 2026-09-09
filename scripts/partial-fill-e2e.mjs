import "dotenv/config";
import pg from "pg";

const assert = (condition, message) => {
  if (!condition) throw new Error(`검증 실패: ${message}`);
};
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  await client.query("begin");
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const accountResult = await client.query(
    "insert into public.accounts(account_number,krw_balance,usd_balance) values($1,1000000,0) returning id",
    [`E2E-PARTIAL-${suffix}`],
  );
  const accountId = accountResult.rows[0].id;
  const pendingResult = await client.query(
    "select public.create_pending_spot_order($1,'005490','stocks','BUY',10,1000,10000) as result",
    [accountId],
  );
  const pendingId = pendingResult.rows[0].result.pending_order.id;
  const orderId = pendingResult.rows[0].result.order.id;

  const partial = (await client.query(
    "select public.place_pending_spot_order($1,$2,900,4) as result",
    [accountId, pendingId],
  )).rows[0].result;
  assert(partial.order.status === "PARTIALLY_FILLED", "첫 체결 상태가 PARTIALLY_FILLED가 아님");
  assert(Number(partial.order.filled_quantity) === 4, "첫 누적 체결수량이 4가 아님");
  assert(Number(partial.order.remaining_quantity) === 6, "첫 잔여수량이 6이 아님");

  const completed = (await client.query(
    "select public.place_pending_spot_order($1,$2,800,6) as result",
    [accountId, pendingId],
  )).rows[0].result;
  assert(completed.order.status === "FILLED", "최종 상태가 FILLED가 아님");
  assert(Number(completed.order.filled_quantity) === 10, "최종 체결수량이 10이 아님");
  assert(Number(completed.order.remaining_quantity) === 0, "최종 잔여수량이 0이 아님");
  assert(Number(completed.order.total_amount) === 8400, "누적 체결금액이 8,400원이 아님");
  assert(Number(completed.order.execution_price) === 840, "평균 체결가가 840원이 아님");

  const state = await client.query(
    `select a.krw_balance,h.quantity,h.avg_price,o.fee_amount,o.tax_amount,
       (select count(*) from public.pending_orders p where p.id=$2) as pending_count,
       (select count(*) from public.cash_ledger c where c.reference_id=$3::text) as cash_count,
       (select count(*) from public.account_ledger l where l.reference_id=$3::text) as ledger_count
     from public.accounts a join public.holdings h on h.account_id=a.id and h.symbol='005490'
     join public.orders o on o.id=$3
     where a.id=$1`,
    [accountId, pendingId, orderId],
  );
  const row = state.rows[0];
  const expectedBalance = 1_000_000 - 8_400 - Number(row.fee_amount) - Number(row.tax_amount);
  assert(Number(row.krw_balance) === expectedBalance, `수수료 반영 계좌잔액 불일치: ${row.krw_balance} / ${expectedBalance}`);
  assert(Number(row.quantity) === 10 && Number(row.avg_price) === 840, "보유수량 또는 평균단가 불일치");
  assert(Number(row.pending_count) === 0, "완료된 주문이 미체결 목록에 남음");
  assert(Number(row.cash_count) === 4, "체결금액·수수료 현금 원장이 4건이 아님");
  assert(Number(row.ledger_count) === 4, "체결금액·수수료 통합 원장이 4건이 아님");

  const events = await client.query(
    "select event_type,filled_quantity,remaining_quantity,execution_price from public.order_events where order_id=$1 order by id",
    [orderId],
  );
  const partialEvent = events.rows.find((event) => event.event_type === "PARTIALLY_FILLED");
  const filledEvent = events.rows.find((event) => event.event_type === "FILLED");
  assert(partialEvent && Number(partialEvent.filled_quantity) === 4 && Number(partialEvent.execution_price) === 900,
    "부분체결 이벤트의 수량 또는 체결가 불일치");
  assert(filledEvent && Number(filledEvent.filled_quantity) === 10 && Number(filledEvent.execution_price) === 800,
    "최종체결 이벤트의 누적수량 또는 회차 체결가 불일치");

  const amendPending = (await client.query(
    "select public.create_pending_spot_order($1,'005490','stocks','BUY',10,1000,10000) as result",
    [accountId],
  )).rows[0].result;
  await client.query("select public.place_pending_spot_order($1,$2,900,4)", [accountId, amendPending.pending_order.id]);
  const amended = (await client.query(
    "select public.amend_pending_spot_order($1,$2,5,950,4750) as result",
    [accountId, amendPending.pending_order.id],
  )).rows[0].result;
  assert(amended.order.status === "PARTIALLY_FILLED", "정정 후 부분체결 상태가 보존되지 않음");
  assert(Number(amended.order.quantity) === 9 && Number(amended.order.filled_quantity) === 4
    && Number(amended.order.remaining_quantity) === 5, "정정 후 총/체결/잔여수량 불일치");
  const cancelled = (await client.query(
    "select public.cancel_pending_spot_order($1,$2) as result",
    [accountId, amendPending.pending_order.id],
  )).rows[0].result;
  assert(cancelled.order.status === "CANCELLED", "부분체결 주문 취소 상태 불일치");
  assert(Number(cancelled.order.filled_quantity) === 4 && Number(cancelled.order.cancelled_quantity) === 5
    && Number(cancelled.order.remaining_quantity) === 0, "취소 후 체결/취소/잔여수량 불일치");
  const amendEvents = (await client.query(
    "select event_type from public.order_events where order_id=$1 order by id",
    [amendPending.order.id],
  )).rows.map((event) => event.event_type);
  assert(amendEvents.join(",") === "ACCEPTED,OPEN,PARTIALLY_FILLED,AMENDED,CANCELLED",
    `부분체결 후 정정·취소 이벤트 순서 불일치: ${amendEvents.join(",")}`);

  console.log(JSON.stringify({
    result: "PASS", statusFlow: ["OPEN", "PARTIALLY_FILLED", "FILLED"],
    balance: Number(row.krw_balance), fee: Number(row.fee_amount), tax: Number(row.tax_amount),
    holdingQuantity: Number(row.quantity), averagePrice: Number(row.avg_price),
    cashLedgerEntries: Number(row.cash_count), accountLedgerEntries: Number(row.ledger_count),
    events: events.rows.map((event) => event.event_type), amendCancelEvents: amendEvents, rolledBack: true,
  }, null, 2));
  await client.query("rollback");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
