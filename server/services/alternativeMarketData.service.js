import { INITIAL_MARKETS } from "../../src/data/markets.js";

const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
const FUTURE_SYMBOLS = {
  K200:"^KS200", KQ150:"^KQ11", NQ:"NQ=F", ES:"ES=F", YM:"YM=F", NKD:"NKD=F",
  CL:"CL=F", GC:"GC=F", SI:"SI=F", NG:"NG=F", HG:"HG=F",
};
const CRYPTO_IDS = {
  BTC:"bitcoin", ETH:"ethereum", SOL:"solana", XRP:"ripple", ADA:"cardano", DOGE:"dogecoin",
  AVAX:"avalanche-2", DOT:"polkadot", LINK:"chainlink", BCH:"bitcoin-cash", LTC:"litecoin", TRX:"tron",
};
const KOREA_BOND_CODES = {
  KR2Y:"010195000", KR3Y:"010200000", KR5Y:"010200001", KR10Y:"010210000", KR20Y:"010220000", KR30Y:"010230000",
};
const US_BOND_FIELDS = { US3M:"BC_3MONTH", US2Y:"BC_2YEAR", US5Y:"BC_5YEAR", US10Y:"BC_10YEAR", US20Y:"BC_20YEAR", US30Y:"BC_30YEAR" };

let cached = null;
let cachedAt = 0;
let loading = null;

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const loadFuture = async ([symbol, yahooTicker]) => {
  const response = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=5d`, {
    headers: { "user-agent":"Mozilla/5.0 POSCO-Securities-Simulator" },
  });
  if (!response.ok) throw new Error(`${symbol} 선물 응답 오류 (${response.status})`);
  const result = (await response.json())?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = (quote.close || []).filter(Number.isFinite);
  const price = Number(meta.regularMarketPrice) || closes.at(-1);
  const previous = Number(meta.chartPreviousClose) || Number(meta.previousClose) || closes.at(-2);
  if (!Number.isFinite(price)) throw new Error(`${symbol} 선물 현재가가 없습니다.`);
  const index = (quote.close || []).findLastIndex(Number.isFinite);
  return {
    symbol, price, change:Number.isFinite(previous) && previous ? ((price - previous) / previous) * 100 : 0,
    open:Number(quote.open?.[index]) || price, high:Number(quote.high?.[index]) || price,
    low:Number(quote.low?.[index]) || price, volume:Number(quote.volume?.[index]) || 0,
    priceSource:symbol === "K200" || symbol === "KQ150" ? "Yahoo 실제 기초지수" : "Yahoo 선물",
    isReal:true, priceUpdatedAt:new Date((meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
  };
};

const loadCrypto = async () => {
  const ids = Object.values(CRYPTO_IDS).join(",");
  const response = await fetchWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=krw&include_24hr_change=true&include_last_updated_at=true`, {
    headers: { accept:"application/json", "user-agent":"POSCO-Securities-Simulator" },
  });
  if (!response.ok) throw new Error(`CoinGecko 응답 오류 (${response.status})`);
  const payload = await response.json();
  return Object.entries(CRYPTO_IDS).flatMap(([symbol, id]) => {
    const row = payload[id];
    if (!Number.isFinite(row?.krw)) return [];
    return [{ symbol, price:row.krw, change:Number(row.krw_24h_change) || 0, priceSource:"CoinGecko", isReal:true, priceUpdatedAt:new Date((row.last_updated_at || Date.now() / 1000) * 1000).toISOString() }];
  });
};

const compactDate = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
const bondQuote = (symbol, yieldValue, previousYield, updatedAt, source) => {
  const base = INITIAL_MARKETS.bonds.find((item) => item.symbol === symbol);
  const price = base ? Math.max(1000, 100000 * (1 - (base.duration * (yieldValue - base.coupon)) / 100)) : 100000;
  return { symbol, price, yield:yieldValue, change:Number.isFinite(previousYield) ? yieldValue - previousYield : 0, priceSource:source, isReal:true, priceUpdatedAt:updatedAt };
};

const loadKoreaBond = async ([symbol, itemCode]) => {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 20);
  const key = process.env.BOK_ECOS_API_KEY || "sample";
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/10/817Y002/D/${compactDate(start)}/${compactDate(end)}/${itemCode}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`${symbol} ECOS 응답 오류 (${response.status})`);
  const rows = (await response.json())?.StatisticSearch?.row || [];
  const values = rows.map((row) => ({ value:Number(row.DATA_VALUE), time:row.TIME })).filter((row) => Number.isFinite(row.value)).sort((a,b) => a.time.localeCompare(b.time));
  if (!values.length) throw new Error(`${symbol} ECOS 금리가 없습니다.`);
  return bondQuote(symbol, values.at(-1).value, values.at(-2)?.value, values.at(-1).time, "한국은행 ECOS");
};

const xmlValue = (entry, field) => Number(entry.match(new RegExp(`<d:${field}[^>]*>([^<]+)</d:${field}>`))?.[1]);
const loadUsBonds = async () => {
  const year = new Date().getUTCFullYear();
  const response = await fetchWithTimeout(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`);
  if (!response.ok) throw new Error(`미 재무부 응답 오류 (${response.status})`);
  const xml = await response.text();
  const entries = [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((match) => match[0]).filter((entry) => entry.includes("NEW_DATE"));
  if (!entries.length) throw new Error("미 재무부 금리 데이터가 없습니다.");
  return Object.entries(US_BOND_FIELDS).flatMap(([symbol, field]) => {
    const current = xmlValue(entries.at(-1), field);
    const previous = xmlValue(entries.at(-2) || "", field);
    const date = entries.at(-1).match(/<d:NEW_DATE[^>]*>([^<]+)/)?.[1] || new Date().toISOString();
    return Number.isFinite(current) ? [bondQuote(symbol, current, previous, date, "미 재무부")] : [];
  });
};

const refresh = async () => {
  const [futureResults, cryptoResult, koreaBondResults, usBondResult] = await Promise.all([
    Promise.allSettled(Object.entries(FUTURE_SYMBOLS).map(loadFuture)),
    loadCrypto().catch(() => []),
    Promise.allSettled(Object.entries(KOREA_BOND_CODES).map(loadKoreaBond)),
    loadUsBonds().catch(() => []),
  ]);
  const items = {
    futures:futureResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    bonds:[...koreaBondResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []), ...usBondResult],
    crypto:cryptoResult,
  };
  if (!items.futures.length && !items.bonds.length && !items.crypto.length) throw new Error("대체시장 실제 시세를 불러오지 못했습니다.");
  cached = { items, updatedAt:new Date().toISOString(), source:"실제 공개시장 데이터" };
  cachedAt = Date.now();
  return cached;
};

const loadQuotes = async ({ force = false } = {}) => {
  if (!force && cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  if (loading) return loading;
  loading = refresh().catch((error) => {
    if (cached) return { ...cached, stale:true, error:error.message };
    throw error;
  }).finally(() => { loading = null; });
  return loading;
};

export default { loadQuotes };
