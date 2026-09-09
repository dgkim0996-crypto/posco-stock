import alternativeMarketDataService from "../services/alternativeMarketData.service.js";

export const getAlternativeQuotes = async (req, res, next) => {
  try {
    res.json(await alternativeMarketDataService.loadQuotes({ force:req.query.refresh === "1" }));
  } catch (error) {
    next(error);
  }
};
