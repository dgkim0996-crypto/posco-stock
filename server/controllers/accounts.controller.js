import accountsService from "../services/accounts.service.js";

// 계좌 라우터의 HTTP 입력을 검증하고 서비스 결과를 상태코드와 JSON으로 변환한다.

export const getAccountById = async (req, res, next) => {
  try {
    const account = await accountsService.getById(req.accountId);

    if (!account) {
      return res.status(404).json({ error: "계좌를 찾을 수 없습니다." });
    }

    return res.json(account);
  } catch (error) {
    next(error);
  }
};

export const getAccountHoldings = async (req, res, next) => {
  // URL의 계좌 ID를 검증한 뒤 계산된 보유상품 평가내역을 반환한다.
  try {
    const result = await accountsService.getHoldings(req.accountId);
    if (!result) return res.status(404).json({ error: "계좌를 찾을 수 없습니다." });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};

export const applyCashOperation = async (req, res, next) => {
  try { return res.json(await accountsService.applyCashOperation(req.accountId, req.body.operation, req.body.amount)); }
  catch (error) { return next(error); }
};

export const resetAccount = async (req, res, next) => {
  try { return res.json(await accountsService.reset(req.accountId)); }
  catch (error) { return next(error); }
};

export const getAccountState = async (req, res, next) => {
  try {
    const state = await accountsService.getState(req.accountId);
    if (!state) return res.status(404).json({ error:"계좌를 찾을 수 없습니다." });
    return res.json(state);
  } catch (error) { return next(error); }
};

export const getAccountLedger = async (req, res, next) => {
  try { return res.json({ items: await accountsService.getLedger(req.accountId, req.query.limit) }); }
  catch (error) { return next(error); }
};

export const getOrderEvents = async (req, res, next) => {
  try { return res.json({ items: await accountsService.getOrderEvents(req.accountId, req.query.limit) }); }
  catch (error) { return next(error); }
};
