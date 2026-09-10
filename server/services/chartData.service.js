import kisAuthService from "./kisAuth.service.js";
import { instruments } from "../data/instruments.data.js";
import kisRequestService from "./kisRequest.service.js";
import marketDatabaseService from "./marketDatabase.service.js";

const EXCHANGE_CODES = { NASDAQ: "NAS", NYSE: "NYS", AMEX: "AMS" };
const MINUTE_PERIODS = new Map([["1m", 1], ["5m", 5], ["30m", 30], ["60m", 60]]);
const VALID_PERIODS = new Set([...MINUTE_PERIODS.keys(), "day"]);
// SQLite 차트를 메모리에 올려 장 종료나 외부 API 장애 때도 즉시 응답한다.
const cache = marketDatabaseService.loadCharts();
// 같은 차트를 여러 요청이 동시에 백그라운드 갱신하지 못하도록 작업을 추적한다.
const refreshing = new Map();

const createError = (status, message) => Object.assign(new Error(message), { status });
const numberValue = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
const textValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "") || "";
const compactDate = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
const koreanMarketQueryTime = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date()).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
  const current = `${parts.hour}${parts.minute}${parts.second}`;
  if (current < "090000") return "090000";
  if (current > "153000") return "153000";
  return current;
};
const koreanMarketDate = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
  return `${parts.year}${parts.month}${parts.day}`;
};
const headers = (token, trId) => ({
  "content-type": "application/json; charset=utf-8",
  authorization: `Bearer ${token}`,
  appkey: process.env.KIS_APP_KEY,
  appsecret: process.env.KIS_APP_SECRET,
  tr_id: trId,
  custtype: "P",
});

// 공통 헤더와 호출 제한 큐를 적용하고 KIS 오류 응답을 예외로 변환한다.
const request = async (url, token, trId) => {
  const response = await kisRequestService.fetchWithLimit(url, { headers: headers(token, trId) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.rt_cd !== "0") {
    const error = kisRequestService.createApiError(data, response, `KIS 차트 조회 실패 (${response.status})`);
    if (!error.status) error.status = response.status || 502;
    throw error;
  }
  return data;
};

// 서로 다른 KIS 응답 필드를 숫자형 OHLCV 객체로 정규화하고 잘못된 봉은 제거한다.
const candle = (time, open, high, low, close, volume) => {
  const closePrice = numberValue(close);
  if (!time || !Number.isFinite(closePrice) || closePrice <= 0) return null;
  const parsedOpen = numberValue(open);
  const parsedHigh = numberValue(high);
  const parsedLow = numberValue(low);
  const openPrice = parsedOpen > 0 ? parsedOpen : closePrice;
  const reportedHigh = parsedHigh > 0 ? parsedHigh : Math.max(openPrice, closePrice);
  const reportedLow = parsedLow > 0 ? parsedLow : Math.min(openPrice, closePrice);
  return {
    time,
    open: openPrice,
    high: Math.max(reportedHigh, openPrice, closePrice),
    low: Math.min(reportedLow, openPrice, closePrice),
    close: closePrice,
    volume: numberValue(volume) ?? 0,
  };
};

// 국내 일자/시각 문자열에 한국 시간대 오프셋을 붙여 ISO 시각으로 만든다.
const parseKoreanDateTime = (date, time = "000000") => {
  if (!date || date.length < 8) return null;
  const normalizedTime = String(time).padStart(6, "0");
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${normalizedTime.slice(0, 2)}:${normalizedTime.slice(2, 4)}:${normalizedTime.slice(4, 6)}+09:00`;
};

// 해외 API의 일자/시각 문자열을 차트가 읽을 수 있는 ISO 형태로 만든다.
const parseOverseasDateTime = (date, time = "000000") => {
  if (!date || date.length < 8) return null;
  const normalizedTime = String(time).padStart(6, "0");
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${normalizedTime.slice(0, 2)}:${normalizedTime.slice(2, 4)}:${normalizedTime.slice(4, 6)}`;
};

const sortCandles = (items) => items.filter(Boolean).sort((a, b) => new Date(a.time) - new Date(b.time));
const previousClockMinute = (time, minutes = 1) => {
  const normalized = String(time).padStart(6, "0");
  const total = Number(normalized.slice(0, 2)) * 60 + Number(normalized.slice(2, 4)) - minutes;
  if (total < 0) return "000000";
  return `${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}00`;
};

const previousOverseasKey = (row, minutes) => {
  const date = String(textValue(row.kymd, row.tymd, row.xymd));
  const time = String(textValue(row.khms, row.xhms)).padStart(6, "0");
  if (date.length < 8) return "";
  const value = new Date(Date.UTC(
    Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)),
    Number(time.slice(0, 2)), Number(time.slice(2, 4)), Number(time.slice(4, 6)),
  ));
  value.setUTCMinutes(value.getUTCMinutes() - minutes);
  return `${compactDate(value)}${String(value.getUTCHours()).padStart(2, "0")}${String(value.getUTCMinutes()).padStart(2, "0")}00`;
};

// 국내 분봉을 최신 시각부터 최대 세 페이지 역방향 조회한다.
// 과거 데이터 포함 옵션으로 휴장일·개장 전에도 직전 영업일 봉을 한 번의 조회 흐름에서 받는다.
const fetchDomesticMinutes = async (instrument, token) => {
  const collected = new Map();
  let queryTime = koreanMarketQueryTime();
  for (let page = 0; page < 3 && queryTime >= "090000"; page += 1) {
    const url = new URL(`${kisAuthService.getBaseUrl()}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice`);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
    url.searchParams.set("FID_INPUT_ISCD", instrument.symbol);
    url.searchParams.set("FID_INPUT_HOUR_1", queryTime);
    url.searchParams.set("FID_INPUT_DATE_1", koreanMarketDate());
    url.searchParams.set("FID_PW_DATA_INCU_YN", "Y");
    url.searchParams.set("FID_FAKE_TICK_INCU_YN", "");
    const data = await request(url, token, "FHKST03010230");
    const rows = data.output2 || [];
    if (!rows.length) break;
    for (const row of rows) {
      const item = candle(
        parseKoreanDateTime(textValue(row.stck_bsop_date, row.bsop_date), textValue(row.stck_cntg_hour, row.cntg_hour)),
        row.stck_oprc, row.stck_hgpr, row.stck_lwpr, row.stck_prpr, textValue(row.cntg_vol, row.acml_vol),
      );
      if (item) collected.set(item.time, item);
    }
    const earliest = rows.map((row) => String(textValue(row.stck_cntg_hour, row.cntg_hour))).filter(Boolean).sort()[0];
    if (!earliest || earliest <= "090000") break;
    const nextTime = previousClockMinute(earliest);
    if (nextTime >= queryTime) break;
    queryTime = nextTime;
  }
  return sortCandles([...collected.values()]).slice(-300);
};

// 해외 분봉은 KIS 연속조회 키를 이동시키며 목표 봉 개수까지 여러 페이지를 합친다.
const fetchOverseasMinutes = async (instrument, token, minutes) => {
  const targetCount = minutes === 1 ? 300 : 60;
  const collected = new Map();
  let key = "";
  for (let page = 0; page < Math.ceil(targetCount / 120); page += 1) {
    const url = new URL(`${kisAuthService.getBaseUrl()}/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice`);
    url.searchParams.set("AUTH", "");
    url.searchParams.set("EXCD", EXCHANGE_CODES[instrument.market]);
    url.searchParams.set("SYMB", instrument.symbol);
    url.searchParams.set("NMIN", String(minutes));
    url.searchParams.set("PINC", "1");
    url.searchParams.set("NEXT", page === 0 ? "" : "1");
    url.searchParams.set("NREC", "120");
    url.searchParams.set("FILL", "");
    url.searchParams.set("KEYB", key);
    const data = await request(url, token, "HHDFS76950200");
    const rows = data.output2 || [];
    if (!rows.length) break;
    for (const row of rows) {
      const item = candle(
        parseOverseasDateTime(textValue(row.kymd, row.tymd, row.xymd), textValue(row.khms, row.xhms)),
        row.open, row.high, row.low, textValue(row.last, row.clos), textValue(row.evol, row.tvol, row.vol),
      );
      if (item) collected.set(item.time, item);
    }
    const oldest = [...rows].sort((a, b) => `${textValue(a.kymd, a.tymd, a.xymd)}${textValue(a.khms, a.xhms)}`.localeCompare(`${textValue(b.kymd, b.tymd, b.xymd)}${textValue(b.khms, b.xhms)}`))[0];
    const nextKey = previousOverseasKey(oldest, minutes);
    if (!nextKey || nextKey === key) break;
    key = nextKey;
  }
  return sortCandles([...collected.values()]).slice(-targetCount);
};

// 국내 최근 150일 범위에서 최대 96개의 일봉을 시간순으로 반환한다.
const fetchDomesticDays = async (instrument, token) => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 150);
  const url = new URL(`${kisAuthService.getBaseUrl()}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`);
  url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
  url.searchParams.set("FID_INPUT_ISCD", instrument.symbol);
  url.searchParams.set("FID_INPUT_DATE_1", compactDate(start));
  url.searchParams.set("FID_INPUT_DATE_2", compactDate(end));
  url.searchParams.set("FID_PERIOD_DIV_CODE", "D");
  url.searchParams.set("FID_ORG_ADJ_PRC", "0");
  const data = await request(url, token, "FHKST03010100");
  return sortCandles((data.output2 || []).map((row) => candle(
    parseKoreanDateTime(row.stck_bsop_date), row.stck_oprc, row.stck_hgpr, row.stck_lwpr, row.stck_clpr, row.acml_vol,
  ))).slice(-96);
};

// 해외 종목의 수정주가 기준 일봉을 받아 공통 OHLCV 구조로 변환한다.
const fetchOverseasDays = async (instrument, token) => {
  const url = new URL(`${kisAuthService.getBaseUrl()}/uapi/overseas-price/v1/quotations/dailyprice`);
  url.searchParams.set("AUTH", "");
  url.searchParams.set("EXCD", EXCHANGE_CODES[instrument.market]);
  url.searchParams.set("SYMB", instrument.symbol);
  url.searchParams.set("GUBN", "0");
  url.searchParams.set("BYMD", "");
  url.searchParams.set("MODP", "1");
  const data = await request(url, token, "HHDFS76240000");
  return sortCandles((data.output2 || []).map((row) => candle(
    parseOverseasDateTime(textValue(row.xymd, row.bymd)), row.open, row.high, row.low, row.clos, row.tvol,
  ))).slice(-96);
};

// Yahoo intraday API는 국내·해외 30/60분 OHLCV를 한 요청으로 넉넉히 반환해 장기 분봉 전환을 빠르게 한다.
const yahooSymbol = (instrument) => {
  if (instrument.market === "KOSPI") return `${instrument.symbol}.KS`;
  if (instrument.market === "KOSDAQ") return `${instrument.symbol}.KQ`;
  return instrument.symbol;
};

const fetchYahooMinutes = async (instrument, period) => {
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

// 여러 1분봉을 N분봉으로 묶어 시가·고가·저가·종가·거래량을 다시 계산한다.
const aggregateMinutes = (items, size) => {
  const groups = new Map();
  for (const item of items) {
    const date = new Date(item.time);
    date.setMinutes(Math.floor(date.getMinutes() / size) * size, 0, 0);
    const key = date.toISOString();
    const current = groups.get(key);
    if (!current) groups.set(key, { ...item, time: key });
    else groups.set(key, {
      ...current,
      high: Math.max(current.high, item.high),
      low: Math.min(current.low, item.low),
      close: item.close,
      volume: current.volume + item.volume,
    });
  }
  return [...groups.values()];
};

// 분봉이 완전히 비어 있을 때 최근 일봉 종가를 장 시작·종료 두 지점으로 만들어 차트를 즉시 표시한다.
const previousCloseCandles = (days) => {
  const latest = days.at(-1);
  if (!latest || !Number.isFinite(latest.close)) return [];
  const date = String(latest.time).slice(0, 10);
  return ["09:00:00", "15:30:00"].map((time) => ({
    time: `${date}T${time}+09:00`,
    open: latest.close,
    high: latest.close,
    low: latest.close,
    close: latest.close,
    volume: 0,
  }));
};

// 장중 분봉 수가 부족하면 실제 최근 영업일 종가를 앞쪽에 붙여 최대 60개 탐색 범위를 보장한다.
const padWithDailyCloses = (items, days, limit = 60) => {
  if (items.length >= limit) return items.slice(-limit);
  const occupiedDates = new Set(items.map((item) => String(item.time).slice(0, 10)));
  const closeHistory = days
    .filter((day) => Number.isFinite(day.close) && !occupiedDates.has(String(day.time).slice(0, 10)))
    .map((day) => {
      const date = String(day.time).slice(0, 10);
      return {
        time: `${date}T15:30:00+09:00`,
        open: day.close,
        high: day.close,
        low: day.close,
        close: day.close,
        volume: 0,
      };
    });
  return sortCandles([...closeHistory, ...items]).slice(-limit);
};

// 새 차트를 메모리와 SQLite에 함께 저장하고 기간별 갱신 유효시간도 기록한다.
const storeChart = (symbol, period, key, items) => {
  const savedAt = new Date().toISOString();
  const entry = { items, savedAt, expiresAt: Date.now() + (period === "day" ? 300_000 : 30_000) };
  cache.set(key, entry);
  try {
    marketDatabaseService.saveChart(symbol, period, entry);
  } catch (error) {
    console.warn(`[SQLite 차트] ${key} 저장 실패:`, error.message);
  }
  return entry;
};

// 시장과 기간에 맞는 KIS API를 호출한 뒤 정상 결과만 저장한다.
const fetchAndCacheChart = async (instrument, period, key) => {
  let items;
  let source = "KIS";
  // 5·30·60분봉은 시장 구분 없이 실제 장중 봉 60개를 한 번에 받는다.
  // 당일 1분봉만 집계하면 장 초반 5분봉 개수가 부족하므로 5분봉도 장기 제공처를 우선한다.
  if (period === "5m" || period === "30m" || period === "60m") {
    try {
      items = await fetchYahooMinutes(instrument, period);
      if (items.length >= 2) {
        const entry = storeChart(instrument.symbol, period, key, items);
        return { symbol: instrument.symbol, period, candles: items, source: "Yahoo Finance", savedAt: entry.savedAt, stale: false };
      }
    } catch (error) {
      console.warn(`[Yahoo 차트] ${instrument.symbol} ${period} 조회 실패, KIS로 대체:`, error.message);
    }
  }

  const token = await kisAuthService.getAccessToken();
  if (period === "day") {
    items = instrument.currency === "KRW"
      ? await fetchDomesticDays(instrument, token)
      : await fetchOverseasDays(instrument, token);
  } else {
    const periodMinutes = MINUTE_PERIODS.get(period);
    try {
      const minutes = instrument.currency === "KRW"
        ? await fetchDomesticMinutes(instrument, token)
        : await fetchOverseasMinutes(instrument, token, periodMinutes);
      items = periodMinutes === 1 || instrument.currency !== "KRW"
        ? minutes
        : aggregateMinutes(minutes, periodMinutes);
    } catch (error) {
      console.warn(`[KIS 분봉] ${instrument.symbol} ${period} 조회 실패, 직전 종가로 대체:`, error.message);
      items = [];
    }
    if (!items.length) {
      const days = instrument.currency === "KRW"
        ? await fetchDomesticDays(instrument, token)
        : await fetchOverseasDays(instrument, token);
      items = previousCloseCandles(days);
      source = "직전 영업일 종가";
    } else if (instrument.currency === "KRW" && (period === "30m" || period === "60m") && items.length < 60) {
      items = padWithDailyCloses(items, await fetchDomesticDays(instrument, token));
      source = "KIS 분봉 + 최근 영업일 종가";
    }
  }
  if (!items.length) throw createError(404, "조회된 차트 데이터가 없습니다.");
  const entry = storeChart(instrument.symbol, period, key, items);

  return { symbol: instrument.symbol, period, candles: items, source, savedAt: entry.savedAt, stale: false };
};

// 저장값은 먼저 보여주고 최신 값은 뒤에서 갱신하는 stale-while-revalidate 처리다.
const refreshInBackground = (instrument, period, key) => {
  if (refreshing.has(key)) return;
  const task = fetchAndCacheChart(instrument, period, key)
    .catch((error) => console.warn(`[KIS 차트] ${key} 갱신 실패, 저장 데이터 유지:`, error.message))
    .finally(() => refreshing.delete(key));
  refreshing.set(key, task);
};

// 메모리/SQLite 복원값을 우선 반환하고, 저장값이 없을 때만 KIS 응답을 기다린다.
const getChart = async (symbol, period) => {
  if (!VALID_PERIODS.has(period)) throw createError(400, "period는 1m, 5m, 30m, 60m, day 중 하나여야 합니다.");
  const instrument = instruments.find((item) => item.symbol.toLowerCase() === symbol.toLowerCase());
  if (!instrument) throw createError(404, "종목을 찾을 수 없습니다.");

  const key = `${period}:${instrument.symbol}`;
  let cached = cache.get(key);
  // 이전 방식으로 만든 짧거나 종가 보충형 분봉은 실제 장기 분봉으로 즉시 교체한다.
  const hasSyntheticCloses = cached?.items?.filter((item) => Number(item.volume) === 0).length > 10;
  if (cached && (period === "5m" || period === "30m" || period === "60m") && (cached.items.length < 60 || hasSyntheticCloses)) {
    try {
      const items = await fetchYahooMinutes(instrument, period);
      if (items.length >= 2) cached = storeChart(instrument.symbol, period, key, items);
    } catch (error) {
      console.warn(`[Yahoo 차트] ${key} 기존 캐시 교체 실패, 저장 데이터 유지:`, error.message);
    }
  }
  if (cached) {
    // 만료된 데이터도 즉시 응답하되 최신 조회는 백그라운드에서 실행한다.
    const stale = !(cached.expiresAt > Date.now());
    if (stale) refreshInBackground(instrument, period, key);
    return { symbol: instrument.symbol, period, candles: cached.items, source: stale ? "저장된 KIS" : "KIS", savedAt: cached.savedAt, stale };
  }

  return fetchAndCacheChart(instrument, period, key);
};

export default { getChart };
