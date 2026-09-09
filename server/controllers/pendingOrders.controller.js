import service from "../services/pendingOrders.service.js";

/** 로그인 사용자의 아직 체결되지 않은 지정가 주문을 반환한다. */
export async function getPendingOrders(req, res, next) {
  try { return res.json({ items: await service.getAll(req.accountId) }); } catch (error) { return next(error); }
}

/** 새 지정가 주문을 계좌에 저장하고 예약 금액을 반영한다. */
export async function createPendingOrder(req, res, next) {
  try { return res.status(201).json(await service.create(req.accountId, req.body)); } catch (error) { return next(error); }
}

/** 남은 수량이 있는 지정가 주문을 취소한다. */
export async function cancelPendingOrder(req, res, next) {
  try { return res.json(await service.remove(req.accountId, req.params.pendingId)); } catch (error) { return next(error); }
}

/** 지정가 주문의 수량과 가격을 수정하고 예약 금액을 다시 계산한다. */
export async function amendPendingOrder(req, res, next) {
  try { return res.json(await service.amend(req.accountId, req.params.pendingId, req.body)); } catch (error) { return next(error); }
}
