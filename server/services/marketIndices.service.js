// 공개 시세 응답에서 주요 지수와 환율을 읽어 한 가지 화면 모델로 변환한다.
const CACHE_TTL_MS = 60 * 1000;
// 공개 ?refresh=1이나 연속 실패가 외부 시세 서버를 반복 호출하지 않도록 조회 시도 사이 최소 간격을 둔다.
const MIN_REFRESH_INTERVAL_MS = 15 * 1000;
const REQUEST_TIMEOUT_MS = 7000;
const SYMBOLS = {
  KOSPI: "^KS11",
  KOSDAQ: "^KQ11",
  NASDAQ: "^IXIC",
  "S&P 500": "^GSPC",
  "USD/KRW": "KRW=X",
};

let cachedIndices = null;
let cachedAt = 0;
let lastAttemptAt = 0;
let inFlight = null;

const loadIndex = async ([name, symbol]) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const encoded = encodeURIComponent(symbol);
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1d&range=5d`, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 POSCO-Securities-Learning-App" },
    });
    if (!response.ok) throw new Error(`${name} 지수 응답 오류 (${response.status})`);
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const meta = result?.meta || {};
    const closes = (result?.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
    const price = Number(meta.regularMarketPrice) || closes.at(-1);
    // chartPreviousClose는 요청 범위(5일) 시작 전 값일 수 있으므로 직전 일봉 종가를 우선한다.
    const previousClose = closes.length > 1 ? closes.at(-2) : Number(meta.previousClose) || Number(meta.chartPreviousClose);
    if (!Number.isFinite(price) || !Number.isFinite(previousClose)) throw new Error(`${name} 지수 값이 올바르지 않습니다.`);
    return { name, value: price, change: ((price - previousClose) / previousClose) * 100 };
  } finally {
    clearTimeout(timeout);
  }
};

const refreshIndices = async () => {
  lastAttemptAt = Date.now();
  const results = await Promise.allSettled(Object.entries(SYMBOLS).map(loadIndex));
  const items = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!items.length && cachedIndices) return cachedIndices;
  if (!items.length) throw Object.assign(new Error("시장 지수를 불러오지 못했습니다."), { status: 503 });
  cachedIndices = { items, updatedAt: new Date().toISOString(), source: "Yahoo Finance" };
  cachedAt = Date.now();
  return cachedIndices;
};

// 동시에 들어온 조회는 하나의 외부 요청을 공유하고, 최소 간격 안의 재조회는 저장된 값을 사용한다.
const loadIndices = async ({ force = false } = {}) => {
  if (inFlight) return inFlight;
  const now = Date.now();
  const expired = !cachedIndices || now - cachedAt >= CACHE_TTL_MS;
  const throttled = now - lastAttemptAt < MIN_REFRESH_INTERVAL_MS;
  if ((!expired && !force) || throttled) {
    if (cachedIndices) return cachedIndices;
    throw Object.assign(new Error("시장 지수를 불러오지 못했습니다."), { status: 503, retryAfter: Math.ceil((lastAttemptAt + MIN_REFRESH_INTERVAL_MS - now) / 1000) });
  }
  inFlight = refreshIndices().finally(() => { inFlight = null; });
  return inFlight;
};

export default { loadIndices };
