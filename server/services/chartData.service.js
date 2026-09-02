import kisAuthService from "./kisAuth.service.js";
import { instruments } from "../data/instruments.data.js";
import kisRequestService from "./kisRequest.service.js";

const EXCHANGE_CODES = { NASDAQ: "NAS", NYSE: "NYS", AMEX: "AMS" };
const VALID_PERIODS = new Set(["1m", "5m", "day"]);
const cache = new Map();

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

const candle = (time, open, high, low, close, volume) => {
  const item = {
    time,
    open: numberValue(open),
    high: numberValue(high),
    low: numberValue(low),
    close: numberValue(close),
    volume: numberValue(volume) ?? 0,
  };
  return item.time && [item.open, item.high, item.low, item.close].every(Number.isFinite) ? item : null;
};

const parseKoreanDateTime = (date, time = "000000") => {
  if (!date || date.length < 8) return null;
  const normalizedTime = String(time).padStart(6, "0");
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${normalizedTime.slice(0, 2)}:${normalizedTime.slice(2, 4)}:${normalizedTime.slice(4, 6)}+09:00`;
};

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

const fetchDomesticMinutes = async (instrument, token) => {
  const collected = new Map();
  let queryTime = koreanMarketQueryTime();
  for (let page = 0; page < 3 && queryTime >= "090000"; page += 1) {
    const url = new URL(`${kisAuthService.getBaseUrl()}/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice`);
    url.searchParams.set("FID_COND_MRKT_DIV_CODE", "J");
    url.searchParams.set("FID_INPUT_ISCD", instrument.symbol);
    url.searchParams.set("FID_INPUT_HOUR_1", queryTime);
    url.searchParams.set("FID_INPUT_DATE_1", koreanMarketDate());
    url.searchParams.set("FID_PW_DATA_INCU_YN", "N");
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

const getChart = async (symbol, period) => {
  if (!VALID_PERIODS.has(period)) throw createError(400, "period는 1m, 5m, day 중 하나여야 합니다.");
  const instrument = instruments.find((item) => item.symbol.toLowerCase() === symbol.toLowerCase());
  if (!instrument) throw createError(404, "종목을 찾을 수 없습니다.");

  const key = `${period}:${instrument.symbol}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { symbol: instrument.symbol, period, candles: cached.items, source: "KIS" };

  const token = await kisAuthService.getAccessToken();
  let items;
  if (period === "day") {
    items = instrument.currency === "KRW"
      ? await fetchDomesticDays(instrument, token)
      : await fetchOverseasDays(instrument, token);
  } else if (instrument.currency === "KRW") {
    const minutes = await fetchDomesticMinutes(instrument, token);
    items = period === "5m" ? aggregateMinutes(minutes, 5) : minutes;
  } else {
    items = await fetchOverseasMinutes(instrument, token, period === "5m" ? 5 : 1);
  }
  if (!items.length) throw createError(404, "조회된 차트 데이터가 없습니다.");
  cache.set(key, { items, expiresAt: Date.now() + (period === "day" ? 300_000 : 30_000) });
  return { symbol: instrument.symbol, period, candles: items, source: "KIS" };
};

export default { getChart };
