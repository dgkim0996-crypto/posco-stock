import investmentFeedService from "../services/investmentFeed.service.js";

export const getInvestmentFeed = async (req, res, next) => {
  try { res.json(await investmentFeedService.loadFeed({ force: req.query.refresh === "1" })); }
  catch (error) { next(error); }
};

// 현재 피드에 포함된 기사만 서버에서 읽어 모달용 본문 데이터로 반환한다.
export const getFeedArticle = async (req, res, next) => {
  try { res.json(await investmentFeedService.loadArticle(String(req.query.url || ""))); }
  catch (error) { next(error); }
};
