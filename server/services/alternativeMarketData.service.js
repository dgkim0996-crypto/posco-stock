import { INITIAL_MARKETS } from "../../src/data/markets.js";

const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 8_000;
// 첫 실패도 최소 한 번의 캐시 갱신 주기(30초)를 건너뛰도록 캐시 수명보다 길게 시작한다.
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 10 * 60_000;
// 거래소 체결시각 허용치. Yahoo 지연시세(국내 지수 20분, CME 10분)를 포함하며, 넘으면 장 마감·지연으로 보고 거래하지 않는다.
export const FUTURES_MARKET_MAX_AGE_MS = 30 * 60_000;
// 서버가 제공처에서 마지막으로 정상 수신한 시각 허용치. 넘으면 시세 장애로 보고 평가·거래·강제청산을 모두 멈춘다.
export const FUTURES_FETCH_MAX_AGE_MS = 2 * 60_000;
// KOSDAQ150 지수는 공개 시세원이 없어 KOSDAQ 종합지수(^KQ11)를 기초자산으로 쓰고 상품명에 그대로 표시한다.
export const FUTURE_SYMBOLS = {
  K200:"^KS200", KQ150:"^KQ11", NQ:"NQ=F", ES:"ES=F", YM:"YM=F", NKD:"NKD=F",
  CL:"CL=F", GC:"GC=F", SI:"SI=F", NG:"NG=F", HG:"HG=F",
};
const FUTURE_SOURCES = { K200:"Yahoo 실제 기초지수(KOSPI200)", KQ150:"Yahoo 실제 기초지수(KOSDAQ 종합)" };
const CRYPTO_IDS = {
  BTC:"bitcoin", ETH:"ethereum", SOL:"solana", XRP:"ripple", ADA:"cardano", DOGE:"dogecoin",
  AVAX:"avalanche-2", DOT:"polkadot", LINK:"chainlink", BCH:"bitcoin-cash", LTC:"litecoin", TRX:"tron",
};
const KOREA_BOND_CODES = {
  KR2Y:"010195000", KR3Y:"010200000", KR5Y:"010200001", KR10Y:"010210000", KR20Y:"010220000", KR30Y:"010230000",
};
const US_BOND_FIELDS = { US3M:"BC_3MONTH", US2Y:"BC_2YEAR", US5Y:"BC_5YEAR", US10Y:"BC_10YEAR", US20Y:"BC_20YEAR", US30Y:"BC_30YEAR" };

export const futurePriceSource = (symbol) => FUTURE_SOURCES[symbol] || "Yahoo 선물";

// 제공처 시각이 없으면 현재 시각으로 꾸미지 않고 null로 남겨 신선도 검사에서 걸러지게 한다.
const isoFromSeconds = (seconds) => Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

/**
 * 선물 시세로 평가(markable)와 거래(tradable)가 가능한지 판정한다.
 * 제공처 수신이 끊기면 둘 다 불가하고, 수신은 정상이나 거래소 시각이 오래되면(장 마감) 마지막 가격으로 평가만 한다.
 */
export function futuresQuoteState(quote, now = Date.now()) {
  const price = Number(quote?.price);
  const fetchedAt = Date.parse(quote?.fetchedAt);
  const tradedAt = Date.parse(quote?.priceUpdatedAt);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(fetchedAt)
    || fetchedAt > now + 60_000 || now - fetchedAt > FUTURES_FETCH_MAX_AGE_MS) {
    return { markable:false, tradable:false, reason:"QUOTE_UNAVAILABLE" };
  }
  if (!Number.isFinite(tradedAt) || tradedAt > now + 60_000 || now - tradedAt > FUTURES_MARKET_MAX_AGE_MS) {
    return { markable:true, tradable:false, price, reason:"MARKET_STALE" };
  }
  return { markable:true, tradable:true, price };
}

const compactDate = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
const bondQuote = (symbol, yieldValue, previousYield, updatedAt, source) => {
  const base = INITIAL_MARKETS.bonds.find((item) => item.symbol === symbol);
  const price = base ? Math.max(1000, 100000 * (1 - (base.duration * (yieldValue - base.coupon)) / 100)) : 100000;
  return { symbol, price, yield:yieldValue, change:Number.isFinite(previousYield) ? yieldValue - previousYield : 0, priceSource:source, isReal:true, priceUpdatedAt:updatedAt };
};
const xmlValue = (entry, field) => Number(entry.match(new RegExp(`<d:${field}[^>]*>([^<]+)</d:${field}>`))?.[1]);

/**
 * 선물·채권·디지털자산 공개시세 저장소를 만든다.
 * 제공처별로 실패를 따로 추적해 백오프하고, 실패한 종목은 마지막 정상값(수신시각 fetchedAt 유지)으로 남긴다.
 */
export function createAlternativeMarketData({ fetchImpl = (...args) => fetch(...args), now = Date.now } = {}) {
  let cached = null;
  let cachedAt = 0;
  let loading = null;
  const lastGood = { futures:new Map(), bonds:new Map(), crypto:new Map() };
  const sourceFailures = new Map();

  const fetchWithTimeout = async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal });
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
    // range=5d의 chartPreviousClose는 조회구간 시작 전(약 5거래일 전) 종가이므로 직전 일봉 종가를 우선한다.
    const previous = closes.length > 1 ? closes.at(-2) : Number(meta.previousClose) || Number(meta.chartPreviousClose);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`${symbol} 선물 현재가가 없습니다.`);
    const index = (quote.close || []).findLastIndex(Number.isFinite);
    return {
      symbol, price, change:Number.isFinite(previous) && previous ? ((price - previous) / previous) * 100 : 0,
      open:Number(quote.open?.[index]) || price, high:Number(quote.high?.[index]) || price,
      low:Number(quote.low?.[index]) || price, volume:Number(quote.volume?.[index]) || 0,
      priceSource:futurePriceSource(symbol), isReal:true, priceUpdatedAt:isoFromSeconds(Number(meta.regularMarketTime)),
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
      return [{ symbol, price:row.krw, change:Number(row.krw_24h_change) || 0, priceSource:"CoinGecko", isReal:true, priceUpdatedAt:isoFromSeconds(Number(row.last_updated_at)) }];
    });
  };

  const loadKoreaBond = async ([symbol, itemCode]) => {
    const end = new Date(now());
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

  const loadUsBonds = async () => {
    const year = new Date(now()).getUTCFullYear();
    const response = await fetchWithTimeout(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`);
    if (!response.ok) throw new Error(`미 재무부 응답 오류 (${response.status})`);
    const xml = await response.text();
    const entries = [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map((match) => match[0]).filter((entry) => entry.includes("NEW_DATE"));
    if (!entries.length) throw new Error("미 재무부 금리 데이터가 없습니다.");
    return Object.entries(US_BOND_FIELDS).flatMap(([symbol, field]) => {
      const current = xmlValue(entries.at(-1), field);
      const previous = xmlValue(entries.at(-2) || "", field);
      const date = entries.at(-1).match(/<d:NEW_DATE[^>]*>([^<]+)/)?.[1] || null;
      return Number.isFinite(current) ? [bondQuote(symbol, current, previous, date, "미 재무부")] : [];
    });
  };

  /** 백오프 중인 제공처는 호출하지 않고, 실패하면 다음 재시도 시각을 지수적으로 늦춘다. */
  const attempt = async (key, loader, startedAt) => {
    const failure = sourceFailures.get(key);
    if (failure && failure.retryAt > startedAt) return [];
    try {
      const items = await loader();
      sourceFailures.delete(key);
      return items;
    } catch (error) {
      const failures = (failure?.failures || 0) + 1;
      sourceFailures.set(key, { failures, retryAt:startedAt + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1)), error:error.message });
      return [];
    }
  };

  const ordered = (category) => {
    const order = INITIAL_MARKETS[category].map((asset) => asset.symbol);
    return [...lastGood[category].values()].sort((left, right) => order.indexOf(left.symbol) - order.indexOf(right.symbol));
  };

  const refresh = async () => {
    const startedAt = now();
    const sources = [
      ...Object.entries(FUTURE_SYMBOLS).map((entry) => ["futures", `futures:${entry[0]}`, async () => [await loadFuture(entry)]]),
      ["crypto", "crypto:coingecko", loadCrypto],
      ...Object.entries(KOREA_BOND_CODES).map((entry) => ["bonds", `bonds:${entry[0]}`, async () => [await loadKoreaBond(entry)]]),
      ["bonds", "bonds:us-treasury", loadUsBonds],
    ];
    const results = await Promise.all(sources.map(async ([category, key, loader]) => [category, await attempt(key, loader, startedAt)]));
    const fetchedAt = new Date(now()).toISOString();
    for (const [category, items] of results) {
      for (const item of items) lastGood[category].set(item.symbol, { ...item, fetchedAt });
    }
    const items = { futures:ordered("futures"), bonds:ordered("bonds"), crypto:ordered("crypto") };
    if (!items.futures.length && !items.bonds.length && !items.crypto.length) throw new Error("대체시장 실제 시세를 불러오지 못했습니다.");
    const degradedSources = [...sourceFailures].map(([source, state]) => ({
      source, failures:state.failures, retryAt:new Date(state.retryAt).toISOString(), error:state.error,
    }));
    cached = { items, updatedAt:fetchedAt, source:"실제 공개시장 데이터", ...(degradedSources.length ? { degradedSources } : {}) };
    cachedAt = now();
    return cached;
  };

  const loadQuotes = async ({ force = false } = {}) => {
    if (!force && cached && now() - cachedAt < CACHE_TTL_MS) return cached;
    if (loading) return loading;
    loading = refresh().catch((error) => {
      if (cached) return { ...cached, stale:true, error:error.message };
      throw error;
    }).finally(() => { loading = null; });
    return loading;
  };

  return { loadQuotes, getCachedQuotes: () => cached };
}

export default createAlternativeMarketData();
