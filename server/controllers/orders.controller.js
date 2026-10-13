import ordersService from "../services/orders.service.js";

// 주문 생성/조회 요청을 서비스에 위임하며 업무 오류는 공통 오류 처리기로 전달한다.

export const createOrder = async (req, res, next) => {
  try {
    if (req.body.pendingOrderId != null) {
      return res.status(409).json({ error: "미체결 지정가 주문은 서버가 시세를 확인해 자동 체결합니다. 계좌 상태를 새로고침해 주세요." });
    }
    return res.status(201).json(await ordersService.createOrder({ ...req.body, accountId: req.accountId }));
  } catch (error) {
    return next(error);
  }
};

export const getOrders = async (req, res, next) => {
  // accountId 쿼리가 있으면 해당 계좌의 주문만 반환한다.
  try {
    return res.json({ items: await ordersService.getAll(req.accountId) });
  } catch (error) {
    return next(error);
  }
};
