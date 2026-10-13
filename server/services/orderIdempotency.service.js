import { getSupabaseAdmin } from "../lib/supabase.js";
import { orderError } from "./spotOrderValidation.js";

/** 확인창에서 한 번 생성한 ID는 응답 유실 후 같은 주문을 재전송할 때도 유지한다. */
export function clientOrderIdOf(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw orderError(400, "중복 주문 방지를 위한 clientOrderId(UUID)가 필요합니다.");
  }
  return value.toLowerCase();
}

/** 체결 시세는 재시도할 때 바뀔 수 있으므로 사용자가 확정한 주문 조건만 비교한다. */
export function orderRequestIdentity({ kind, symbol, category, side, quantity, orderType, price }) {
  return { kind, symbol, category, side, quantity: Number(quantity), orderType,
    price: price == null ? null : Number(price) };
}

/** 시세/가용량 확인 전에 완료된 요청을 재생한다. 실제 동시성 보호는 *_once RPC가 담당한다. */
export async function getOrderRequest(input, client = getSupabaseAdmin()) {
  const { data, error } = await client.rpc("get_order_request", {
    p_account_id: input.accountId,
    p_client_order_id: clientOrderIdOf(input.clientOrderId),
    p_request: orderRequestIdentity(input),
  });
  if (error) {
    if (error.code === "P4090") throw orderError(409, error.message, error);
    if (error.code === "22023") throw orderError(400, error.message, error);
    throw orderError(503, "기존 주문 처리 결과를 확인하지 못했습니다. 같은 주문번호로 다시 시도해 주세요.", error);
  }
  return data ?? null;
}
