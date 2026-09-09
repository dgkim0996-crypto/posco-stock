import kisAuthService from "./kisAuth.service.js";
import { instruments } from "../data/instruments.data.js";
import kisRequestService from "./kisRequest.service.js";
import marketDatabaseService from "./marketDatabase.service.js";

const TRACKED_INSTRUMENTS = instruments.filter(({ market }) =>
  ["KOSPI", "KOSDAQ", "NASDAQ", "NYSE"].includes(market),
);
const EXCHANGE_CODES = { NASDAQ: "NAS", NYSE: "NYS", AMEX: "AMS" };
const quoteCache = new Map();
const quoteErrors = new Map();
let pollingTimer = null;
let pollingIndex = 0;
let lastError = null;
let lastLiveUpdateAt = null;
let lastPollAttemptAt = null;
let consecutiveFailures = 0;
// 재시작 직후에도 마지막 정상 시세를 반환하도록 SQLite 값을 메모리에 복원한다.
for (const quote of marketDatabaseService.loadQuotes()) quoteCache.set(quote.symbol, quote);

const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// 국내 현재가 API 응답 필드를 화면의 공통 시세 모델로 변환한다.
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

// 해외 거래소 코드를 적용해 해외 현재가를 조회하고 국내 시세와 같은 구조로 변환한다.
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

// 종목의 통화로 국내/해외 조회 함수를 선택한 뒤 정상 가격을 메모리와 SQLite에 반영한다.
const fetchQuote = async (symbol) => {
  const instrument = TRACKED_INSTRUMENTS.find((item) => item.symbol === symbol);
  if (!instrument) throw new Error(`지원하지 않는 종목입니다: ${symbol}`);
  const token = await kisAuthService.getAccessToken();
  const quote = instrument.currency === "KRW"
    ? await fetchDomesticQuote(instrument, token)
    : await fetchOverseasQuote(instrument, token);
  if (!Number.isFinite(quote.price)) throw new Error(`${symbol} 현재가 응답이 올바르지 않습니다.`);
  // 정상 응답만 반영한다. DB 저장 실패 시에도 이번에 수신한 값은 메모리에서 계속 제공한다.
  quoteCache.set(symbol, quote);
  lastLiveUpdateAt = quote.updatedAt;
  try {
    marketDatabaseService.saveQuote(quote);
  } catch (error) {
    console.warn(`[SQLite 시세] ${symbol} 저장 실패:`, error.message);
  }
  quoteErrors.delete(symbol);
  lastError = null;
  return quote;
};

// KIS 호출 제한을 지키면서 추적 대상 종목을 하나씩 순환 조회한다.
const pollNext = async () => {
  const instrument = TRACKED_INSTRUMENTS[pollingIndex % TRACKED_INSTRUMENTS.length];
  const { symbol } = instrument;
  pollingIndex += 1;
  lastPollAttemptAt = new Date().toISOString();
  try {
    await fetchQuote(symbol);
    consecutiveFailures = 0;
  } catch (error) {
    consecutiveFailures += 1;
    lastError = { message: error.message, occurredAt: new Date().toISOString() };
    quoteErrors.set(symbol, lastError);
    console.error(`[KIS 시세] ${instrument.market} ${symbol} 조회 실패:`, error.message);
  } finally {
    pollingTimer = setTimeout(pollNext, 1100);
  }
};

// 서버 시작 시 한 번만 순환 수집을 시작하며 KIS 설정이 없으면 즉시 원인을 알린다.
const startPolling = () => {
  if (pollingTimer) return;
  kisAuthService.validateConfig();
  pollNext();
};

// 테스트나 서버 종료 처리에서 다음 예약 조회를 취소할 수 있게 한다.
const stopPolling = () => {
  if (pollingTimer) clearTimeout(pollingTimer);
  pollingTimer = null;
};

const getQuotes = () => TRACKED_INSTRUMENTS.map(({ symbol }) => quoteCache.get(symbol)).filter(Boolean);
const getQuote = (symbol) => quoteCache.get(symbol) || null;
// WebSocket 체결가를 REST와 동일한 캐시에 합쳐 주문·화면·폴백이 한 가격을 사용하게 한다.
const ingestRealtimeQuote = (quote) => {
  if (!quote?.symbol || !Number.isFinite(quote.price)) return null;
  const previous = quoteCache.get(quote.symbol) || {};
  const merged = { ...previous, ...quote, source: "KIS WebSocket", isReal: true, updatedAt: quote.updatedAt || new Date().toISOString() };
  quoteCache.set(quote.symbol, merged);
  lastLiveUpdateAt = merged.updatedAt;
  quoteErrors.delete(quote.symbol);
  lastError = null;
  try { marketDatabaseService.saveQuote(merged); } catch (error) {
    console.warn(`[SQLite 실시간 시세] ${quote.symbol} 저장 실패:`, error.message);
  }
  return merged;
};
// ok는 이번 실행 중 KIS 수신 여부, servingSavedData는 DB 복원값만 제공 중임을 의미한다.
const getStatus = () => ({
  ok: Boolean(lastLiveUpdateAt),
  polling: Boolean(pollingTimer),
  environment: kisAuthService.getEnvironment(),
  trackedSymbols: TRACKED_INSTRUMENTS.length,
  cachedSymbols: quoteCache.size,
  failedSymbols: quoteErrors.size,
  lastError,
  lastLiveUpdateAt,
  lastPollAttemptAt,
  consecutiveFailures,
  servingSavedData: quoteCache.size > 0 && !lastLiveUpdateAt,
});

export default { fetchQuote, getQuote, getQuotes, getStatus, ingestRealtimeQuote, startPolling, stopPolling };
