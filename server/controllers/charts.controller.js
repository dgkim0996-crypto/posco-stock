import chartDataService from "../services/chartData.service.js";

// 종목코드와 기간 쿼리를 차트 서비스에 전달하고 비동기 오류는 공통 미들웨어로 넘긴다.

export const getChart = async (req, res, next) => {
  try {
    res.json(await chartDataService.getChart(req.params.symbol, req.query.period || "1m"));
  } catch (error) {
    next(error);
  }
};
