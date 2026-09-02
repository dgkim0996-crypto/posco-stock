import kisAuthService from "./kisAuth.service.js";

const POSCO_SYMBOLS = ["005490", "003670", "047050", "022100", "058430", "009520"];
const quoteCache = new Map();
let pollingTimer = null;
let pollingIndex = 0;
let lastError = null;

const numberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const fetchQuote = async (symbol) => {
  const token = await kisAuthService.getAccessToken();
  const url = new URL(`${kisAuthService.getBaseUrl()}/uapi/domestic-stock/v1/quotations/inquire-price`);
  url.searchParams.set("fid_cond_mrkt_div_code", "J");
  url.searchParams.set("fid_input_iscd", symbol);

  const response = await fetch(url, {
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
    throw new Error(data.msg1 || `KIS 현재가 조회 실패 (${response.status})`);
  }

  const output = data.output;
  const quote = {
    symbol,
    price: numberValue(output.stck_prpr),
    changeAmount: numberValue(output.prdy_vrss),
    change: numberValue(output.prdy_ctrt),
    open: numberValue(output.stck_oprc),
    high: numberValue(output.stck_hgpr),
    low: numberValue(output.stck_lwpr),
    volume: numberValue(output.acml_vol),
    source: "KIS",
    isReal: true,
    updatedAt: new Date().toISOString(),
  };
  quoteCache.set(symbol, quote);
  lastError = null;
  return quote;
};

const pollNext = async () => {
  const symbol = POSCO_SYMBOLS[pollingIndex % POSCO_SYMBOLS.length];
  pollingIndex += 1;
  try {
    await fetchQuote(symbol);
  } catch (error) {
    lastError = { message: error.message, occurredAt: new Date().toISOString() };
    console.error(`[KIS 시세] ${symbol} 조회 실패:`, error.message);
  } finally {
    pollingTimer = setTimeout(pollNext, lastError ? 10_000 : 1100);
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

const getQuotes = () => POSCO_SYMBOLS.map((symbol) => quoteCache.get(symbol)).filter(Boolean);
const getQuote = (symbol) => quoteCache.get(symbol) || null;
const getStatus = () => ({
  ok: !lastError,
  environment: kisAuthService.getEnvironment(),
  trackedSymbols: POSCO_SYMBOLS.length,
  cachedSymbols: quoteCache.size,
  lastError,
});

export default { fetchQuote, getQuote, getQuotes, getStatus, startPolling, stopPolling };
