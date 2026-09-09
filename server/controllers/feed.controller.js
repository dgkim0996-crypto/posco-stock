import investmentFeedService from "../services/investmentFeed.service.js";

export const getInvestmentFeed = async (req, res, next) => {
  try { res.json(await investmentFeedService.loadFeed({ force: req.query.refresh === "1" })); }
  catch (error) { next(error); }
};
