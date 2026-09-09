import financeService from "../services/finance.service.js";

/** 사용자의 신용·미수·담보·대주 약정 상태를 조회한다. */
export async function getFinance(req, res, next) {
  try { return res.json(await financeService.getAll(req.accountId)); } catch (error) { return next(error); }
}

/** 선택한 금융상품을 실행해 현금과 부채·담보 원장을 함께 반영한다. */
export async function executeFinance(req, res, next) {
  try { return res.status(201).json(await financeService.execute(req.accountId, req.params.product, req.body.amount)); } catch (error) { return next(error); }
}

/** 선택한 금융상품의 잔액을 정산하거나 약정을 해지한다. */
export async function settleFinance(req, res, next) {
  try { return res.json(await financeService.settle(req.accountId, req.params.product)); } catch (error) { return next(error); }
}
