import futuresService from "../services/futures.service.js";

/** 현재 계좌의 미결제 선물 포지션을 반환한다. */
export async function getFutures(req, res, next) {
  try { return res.json({ items: await futuresService.getAll(req.accountId) }); } catch (error) { return next(error); }
}

/** 증거금을 확인해 새 선물 포지션을 개설한다. */
export async function openFuture(req, res, next) {
  try { return res.status(201).json(await futuresService.open(req.accountId, req.body)); } catch (error) { return next(error); }
}

/** 현재 계좌가 소유한 선물 포지션 하나를 청산한다. */
export async function closeFuture(req, res, next) {
  try { return res.json(await futuresService.close(req.accountId, req.params.positionId)); } catch (error) { return next(error); }
}
