import instrumentsService from "../services/instruments.service.js";

// 종목 목록 검색과 단일 종목 조회의 HTTP 요청/응답을 담당한다.

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
  // URL 종목코드로 검색하고 없으면 404를 반환한다.
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
