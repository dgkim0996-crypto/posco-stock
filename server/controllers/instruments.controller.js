import instrumentsService from "../services/instruments.service.js";

export const getAllInstruments = async (req, res, next) => {
  try {
    const { market, type, q } = req.query;
    const items = instrumentsService.getAll({ market, type, q });
    return res.json({ items });
  } catch (error) {
    next(error);
  }
};

export const getInstrumentBySymbol = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    const item = instrumentsService.getBySymbol(symbol);

    if (!item) {
      return res.status(404).json({ error: "종목을 찾을 수 없습니다." });
    }

    return res.json(item);
  } catch (error) {
    next(error);
  }
};
