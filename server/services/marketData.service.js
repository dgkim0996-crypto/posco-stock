import kisAuthService from "./kisAuth.service.js";
import { instruments } from "../data/instruments.data.js";
import kisRequestService from "./kisRequest.service.js";

const TRACKED_INSTRUMENTS = instruments.filter(({ market }) =>
  ["KOSPI", "KOSDAQ", "NASDAQ", "NYSE"].includes(market),
);
const EXCHANGE_CODES = { NASDAQ: "NAS", NYSE: "NYS", AMEX: "AMS" };
const quoteCache = new Map();
const quoteErrors = new Map();
let pollingTimer = null;
let pollingIndex = 0;
let lastError = null;

const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const fetchDomesticQuote = async (instrument, token) => {
  const { symbol } = instrument;
  const url = new URL(`${kisAuthService.getBaseUrl()}/uapi/domestic-stock/v1/quotations/inquire-price`);
  url.searchParams.set("fid_cond_mrkt_div_code", "J");
  url.searchParams.set("fid_input_iscd", symbol);

  const response = await kisRequestService.fetchWithLimit(url, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: "FHKST01010100",
      custtype: "P",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.rt_cd !== "0" || !data.output) {
    throw kisRequestService.createApiError(data, response, `KIS 현재가 조회 실패 (${response.status})`);
  }

  const output = data.output;
  return {
    symbol,
    price: numberValue(output.stck_prpr),
    changeAmount: numberValue(output.prdy_vrss),
    change: numberValue(output.prdy_ctrt),
    open: numberValue(output.stck_oprc),
    high: numberValue(output.stck_hgpr),
    low: numberValue(output.stck_lwpr),
    volume: numberValue(output.acml_vol),
    source: "KIS 국내",
    isReal: true,
    updatedAt: new Date().toISOString(),
  };
};

const fetchOverseasQuote = async (instrument, token) => {
  const { symbol, market } = instrument;
  const url = new URL(`${kisAuthService.getBaseUrl()}/uapi/overseas-price/v1/quotations/price`);
  url.searchParams.set("AUTH", "");
  url.searchParams.set("EXCD", EXCHANGE_CODES[market]);
  url.searchParams.set("SYMB", symbol);

  const response = await kisRequestService.fetchWithLimit(url, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: process.env.KIS_APP_KEY,
      appsecret: process.env.KIS_APP_SECRET,
      tr_id: "HHDFS00000300",
      custtype: "P",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.rt_cd !== "0" || !data.output) {
    throw kisRequestService.createApiError(data, response, `KIS 해외 현재가 조회 실패 (${response.status})`);
  }

  const output = data.output;
  return {
    symbol,
    price: numberValue(output.last),
    changeAmount: numberValue(output.diff),
    change: numberValue(output.rate),
    open: numberValue(output.open),
    high: numberValue(output.high),
    low: numberValue(output.low),
    volume: numberValue(output.tvol),
    source: "KIS 해외",
    isReal: true,
    updatedAt: new Date().toISOString(),
  };
};

const fetchQuote = async (symbol) => {
  const instrument = TRACKED_INSTRUMENTS.find((item) => item.symbol === symbol);
  if (!instrument) throw new Error(`지원하지 않는 종목입니다: ${symbol}`);
  const token = await kisAuthService.getAccessToken();
  const quote = instrument.currency === "KRW"
    ? await fetchDomesticQuote(instrument, token)
    : await fetchOverseasQuote(instrument, token);
  if (!Number.isFinite(quote.price)) throw new Error(`${symbol} 현재가 응답이 올바르지 않습니다.`);
  quoteCache.set(symbol, quote);
  quoteErrors.delete(symbol);
  lastError = null;
  return quote;
};

const pollNext = async () => {
  const instrument = TRACKED_INSTRUMENTS[pollingIndex % TRACKED_INSTRUMENTS.length];
  const { symbol } = instrument;
  pollingIndex += 1;
  try {
    await fetchQuote(symbol);
  } catch (error) {
    lastError = { message: error.message, occurredAt: new Date().toISOString() };
    quoteErrors.set(symbol, lastError);
    console.error(`[KIS 시세] ${instrument.market} ${symbol} 조회 실패:`, error.message);
  } finally {
    pollingTimer = setTimeout(pollNext, 1100);
  }
};

const startPolling = () => {
  if (pollingTimer) return;
  kisAuthService.validateConfig();
  pollNext();
};

const stopPolling = () => {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = null;
};

const getQuotes = () => TRACKED_INSTRUMENTS.map(({ symbol }) => quoteCache.get(symbol)).filter(Boolean);
const getQuote = (symbol) => quoteCache.get(symbol) || null;
const getStatus = () => ({
  ok: quoteCache.size > 0,
  environment: kisAuthService.getEnvironment(),
  trackedSymbols: TRACKED_INSTRUMENTS.length,
  cachedSymbols: quoteCache.size,
  failedSymbols: quoteErrors.size,
  lastError,
});

export default { fetchQuote, getQuote, getQuotes, getStatus, startPolling, stopPolling };
