import service from "../services/risk.service.js";

/** 선물·금융 위험을 평가한다. 청산단계 계좌는 조회 요청에서도 서버 주기 감시와 같은 기준으로 강제청산된다. */
export async function evaluateRisk(req, res, next) {
  try {
    return res.json(await service.evaluate(req.accountId));
  } catch (error) {
    return next(error);
  }
}
