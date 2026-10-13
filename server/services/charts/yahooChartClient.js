import { createError } from "./chartConfig.js";
import { candle, sortCandles } from "./chartTransforms.js";

// Yahoo intraday API는 국내·해외 30/60분 OHLCV를 한 요청으로 넉넉히 반환해 장기 분봉 전환을 빠르게 한다.
const yahooSymbol = (instrument) => {
  if (instrument.market === "KOSPI") return `${instrument.symbol}.KS`;
  if (instrument.market === "KOSDAQ") return `${instrument.symbol}.KQ`;
  return instrument.symbol;
};

export const fetchYahooMinutes = async (instrument, period) => {
  const symbol = encodeURIComponent(yahooSymbol(instrument));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${period}&range=1mo&includePrePost=false&events=div%2Csplits`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 POSCO-Securities-Simulator" } });
  if (!response.ok) throw createError(response.status || 502, `Yahoo ${period} 차트 조회 실패 (${response.status})`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const items = timestamps.map((timestamp, index) => candle(
    new Date(timestamp * 1000).toISOString(),
    quote.open?.[index], quote.high?.[index], quote.low?.[index], quote.close?.[index], quote.volume?.[index],
  ));
  return sortCandles(items).slice(-60);
};
