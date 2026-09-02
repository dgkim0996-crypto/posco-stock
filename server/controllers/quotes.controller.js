import marketDataService from "../services/marketData.service.js";

export const getQuotes = (req, res) => {
  res.json({ items: marketDataService.getQuotes(), status: marketDataService.getStatus() });
};

export const getQuoteBySymbol = (req, res) => {
  const quote = marketDataService.getQuote(req.params.symbol);
  if (!quote) return res.status(404).json({ error: "아직 수신된 시세가 없습니다." });
  return res.json(quote);
};

export const getMarketStatus = (req, res) => {
  res.json(marketDataService.getStatus());
};
