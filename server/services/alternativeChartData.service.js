import { INITIAL_MARKETS } from "../../src/data/markets.js";
import alternativeMarketDataService from "./alternativeMarketData.service.js";

const VALID_PERIODS = new Set(["1m", "5m", "30m", "60m", "day"]);
const PERIOD_MS = { "1m":60_000, "5m":300_000, "30m":1_800_000, "60m":3_600_000, day:86_400_000 };
const FUTURE_SYMBOLS = {
  K200:"^KS200", KQ150:"^KQ11", NQ:"NQ=F", ES:"ES=F", YM:"YM=F", NKD:"NKD=F",
  CL:"CL=F", GC:"GC=F", SI:"SI=F", NG:"NG=F", HG:"HG=F",
};
const cache = new Map();

const createError = (status, message) => Object.assign(new Error(message), { status });
const candle = (time, open, high, low, close, volume = 0) => {
  const item = { time, open:Number(open), high:Number(high), low:Number(low), close:Number(close), volume:Number(volume) || 0 };
  return item.time && [item.open,item.high,item.low,item.close].every(Number.isFinite) ? item : null;
};

const fetchYahooChart = async (ticker, period) => {
  const range = period === "1m" ? "5d" : period === "day" ? "6mo" : "1mo";
  const interval = period === "day" ? "1d" : period;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&includePrePost=false`;
  const response = await fetch(url, { headers:{ "user-agent":"Mozilla/5.0 POSCO-Securities-Simulator" } });
  if (!response.ok) throw createError(response.status || 502, `Yahoo 차트 응답 오류 (${response.status})`);
  const result = (await response.json())?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const items = (result?.timestamp || []).map((timestamp,index) => candle(
    new Date(timestamp * 1000).toISOString(), quote.open?.[index], quote.high?.[index], quote.low?.[index], quote.close?.[index], quote.volume?.[index],
  )).filter(Boolean).slice(-60);
  if (items.length < 2) throw createError(404, "조회된 실제 분봉이 없습니다.");
  return items;
};

const bondChart = async (symbol, period) => {
  const payload = await alternativeMarketDataService.loadQuotes();
  const quote = payload.items.bonds.find((item) => item.symbol === symbol);
  if (!quote || !Number.isFinite(quote.price)) throw createError(404, "공시된 채권 금리가 없습니다.");
  const interval = PERIOD_MS[period];
  const end = Date.now();
  return Array.from({ length:60 }, (_,index) => candle(
    new Date(end - (59 - index) * interval).toISOString(), quote.price, quote.price, quote.price, quote.price, 0,
  ));
};

const getChart = async (category, symbol, period) => {
  if (!VALID_PERIODS.has(period)) throw createError(400, "period는 1m, 5m, 30m, 60m, day 중 하나여야 합니다.");
  if (!['futures','bonds','crypto'].includes(category)) throw createError(400, "지원하지 않는 상품군입니다.");
  const asset = INITIAL_MARKETS[category]?.find((item) => item.symbol === symbol);
  if (!asset) throw createError(404, "종목을 찾을 수 없습니다.");
  const key = `${category}:${symbol}:${period}`;
  const stored = cache.get(key);
  if (stored?.expiresAt > Date.now()) return { ...stored.payload, stale:false };

  let candles;
  let source;
  if (category === "futures") {
    candles = await fetchYahooChart(FUTURE_SYMBOLS[symbol], period);
    source = symbol === "K200" || symbol === "KQ150" ? "Yahoo 실제 기초지수" : "Yahoo 선물";
  } else if (category === "crypto") {
    candles = await fetchYahooChart(`${symbol}-KRW`, period);
    source = "Yahoo 디지털자산";
  } else {
    candles = await bondChart(symbol, period);
    source = "최근 실제 공시금리";
  }
  const payload = { category, symbol, period, candles, source, savedAt:new Date().toISOString() };
  cache.set(key, { payload, expiresAt:Date.now() + 30_000 });
  return { ...payload, stale:false };
};

export default { getChart };
