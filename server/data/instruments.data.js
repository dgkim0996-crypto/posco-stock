import { INITIAL_MARKETS } from "../../src/data/markets.js";

// 화면에 등록된 주식 목록을 API의 종목 원본으로도 사용해 양쪽 목록이 어긋나지 않게 한다.
// 화면 모델을 서버 모델(symbol/name/market/type/currency/price)로 변환한다.
export const instruments = INITIAL_MARKETS.stocks.map((stock) => ({
  symbol: stock.symbol,
  name: stock.name,
  market: stock.market,
  type: stock.group === "ETF" ? "ETF" : "STOCK",
  currency: stock.unit,
  price: stock.price,
  kospiRank: stock.kospiRank || null,
}));
