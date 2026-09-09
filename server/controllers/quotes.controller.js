import marketDataService from "../services/marketData.service.js";
import kisWebSocketService from "../services/kisWebSocket.service.js";

// 메모리에 준비된 시세와 수집 상태를 지연 없이 HTTP 응답으로 제공한다.

export const getQuotes = (req, res) => {
  res.json({ items: marketDataService.getQuotes(), status: marketDataService.getStatus() });
};

export const getQuoteBySymbol = (req, res) => {
  // 아직 DB나 KIS에서 한 번도 확보하지 못한 종목은 404로 구분한다.
  const quote = marketDataService.getQuote(req.params.symbol);
  if (!quote) return res.status(404).json({ error: "아직 수신된 시세가 없습니다." });
  return res.json(quote);
};

export const getMarketStatus = (req, res) => {
  // 실제 KIS 연결 여부, 저장 종목 수, 마지막 오류 등 운영 상태를 반환한다.
  res.json({ rest: marketDataService.getStatus(), realtime: kisWebSocketService.getStatus() });
};
