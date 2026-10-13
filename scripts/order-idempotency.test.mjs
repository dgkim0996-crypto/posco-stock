import test from "node:test";
import assert from "node:assert/strict";
import { clientOrderIdOf, getOrderRequest, orderRequestIdentity } from "../server/services/orderIdempotency.service.js";

const id = "A1B2C3D4-1111-4222-8333-123456789ABC";
const request = { accountId: 9, clientOrderId: id, kind: "SPOT", symbol: "005490", category: "stocks", side: "BUY", quantity: 2, orderType: "MARKET", price: null };

test("신규 주문은 유효한 UUID를 요구하고 대소문자는 같은 키로 처리한다", () => {
  assert.equal(clientOrderIdOf(id), id.toLowerCase());
  for (const value of [undefined, null, "", 12, "new-order", ` ${id}`, `${id}x`]) {
    assert.throws(() => clientOrderIdOf(value), (error) => error.status === 400);
  }
});

test("주문 조건에는 체결가와 조회 시각을 포함하지 않는다", () => {
  const identity = orderRequestIdentity({ ...request, quantity: "2", executionPrice: 1200, updatedAt: "before" });
  assert.deepEqual(identity, { kind: "SPOT", symbol: "005490", category: "stocks", side: "BUY", quantity: 2, orderType: "MARKET", price: null });
  assert.deepEqual(identity, orderRequestIdentity({ ...request, executionPrice: 1500, updatedAt: "after" }));
  assert.notDeepEqual(identity, orderRequestIdentity({ ...request, quantity: 3 }));
});

test("완료 결과는 원본 그대로 반환하고 계좌 범위와 주문 조건을 DB에 전달한다", async () => {
  const cached = { order: { id: "original" }, account: { krw_balance: 100 } };
  const result = await getOrderRequest(request, { async rpc(name, args) {
    assert.equal(name, "get_order_request");
    assert.equal(args.p_account_id, 9);
    assert.equal(args.p_client_order_id, id.toLowerCase());
    assert.deepEqual(args.p_request, orderRequestIdentity(request));
    return { data: cached, error: null };
  } });
  assert.equal(result, cached);
  assert.equal(await getOrderRequest(request, { async rpc() { return { data: null, error: null }; } }), null);
});

test("충돌은 409, 조회 장애는 503이며 미처리 주문으로 오인하지 않는다", async () => {
  for (const [code, status] of [["P4090", 409], ["22023", 400], ["08006", 503]]) {
    await assert.rejects(getOrderRequest(request, { async rpc() { return { data: null, error: { code, message: "lookup failed" } }; } }),
      (error) => error.status === status);
  }
});
