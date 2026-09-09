import service from "../services/settlements.service.js";

/** D+2 도래분을 처리한 뒤 계좌의 결제 예정·완료 내역을 반환한다. */
export async function getSettlements(req, res, next) {
  try { return res.json(await service.getAll(req.accountId)); } catch (error) { return next(error); }
}

/** 화면에 표시할 모의 거래 수수료와 세율 정책을 반환한다. */
export async function getChargePolicies(req, res, next) {
  try { return res.json({ items: await service.getPolicies() }); } catch (error) { return next(error); }
}
