import alternativeChartDataService from "../services/alternativeChartData.service.js";

export const getAlternativeChart = async (req,res,next) => {
  try {
    res.json(await alternativeChartDataService.getChart(req.params.category, req.params.symbol, req.query.period || "1m"));
  } catch (error) {
    next(error);
  }
};
