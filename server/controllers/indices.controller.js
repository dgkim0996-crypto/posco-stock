import marketIndicesService from "../services/marketIndices.service.js";

export const getMarketIndices = async (req, res, next) => {
  try {
    res.json(await marketIndicesService.loadIndices({ force: req.query.refresh === "1" }));
  } catch (error) {
    next(error);
  }
};
