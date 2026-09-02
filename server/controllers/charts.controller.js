import chartDataService from "../services/chartData.service.js";

export const getChart = async (req, res, next) => {
  try {
    res.json(await chartDataService.getChart(req.params.symbol, req.query.period || "1m"));
  } catch (error) {
    next(error);
  }
};
