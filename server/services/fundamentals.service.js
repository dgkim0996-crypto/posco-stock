import kisAuthService from "./kisAuth.service.js";
import kisRequestService from "./kisRequest.service.js";
import { instruments } from "../data/instruments.data.js";

const cache = new Map();
// 같은 종목의 동시 요청은 하나의 KIS 조회를 공유해 직렬 큐를 반복 점유하지 않게 한다.
const inFlight = new Map();
const CACHE_MS = 10 * 60 * 1000;
// 공개 경로에서 임의 종목코드로 KIS를 호출하지 못하도록 서비스 중인 국내 종목만 조회한다.
const SUPPORTED_SYMBOLS = new Set(instruments
  .filter((item) => ["KOSPI", "KOSDAQ"].includes(item.market) && /^\d{6}$/.test(item.symbol))
  .map((item) => item.symbol));
const number = (value) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };

async function kisGet(path, trId, params, token) {
  const url = new URL(`${kisAuthService.getBaseUrl()}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await kisRequestService.fetchWithLimit(url, { headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}`, appkey: process.env.KIS_APP_KEY, appsecret: process.env.KIS_APP_SECRET, tr_id: trId, custtype: "P" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.rt_cd !== "0") throw kisRequestService.createApiError(data, response, `KIS 종목정보 조회 실패 (${response.status})`);
  return data.output;
}

export async function getFundamentals(symbol) {
  if (!/^\d{6}$/.test(symbol)) return { symbol, supported: false, source: null, message: "해외주식 재무지표 데이터 소스가 연결되지 않았습니다." };
  if (!SUPPORTED_SYMBOLS.has(symbol)) return { symbol, supported: false, source: null, message: "재무지표를 제공하지 않는 종목입니다." };
  const saved = cache.get(symbol);
  if (saved && Date.now() - saved.savedAt < CACHE_MS) return saved.data;
  if (!inFlight.has(symbol)) {
    inFlight.set(symbol, loadFundamentals(symbol).finally(() => inFlight.delete(symbol)));
  }
  return inFlight.get(symbol);
}

async function loadFundamentals(symbol) {
  const token = await kisAuthService.getAccessToken();
  const quote = await kisGet("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", { fid_cond_mrkt_div_code: "J", fid_input_iscd: symbol }, token);
  let ratios = [];
  try {
    ratios = await kisGet("/uapi/domestic-stock/v1/finance/financial-ratio", "FHKST66430300", { FID_DIV_CLS_CODE: "0", fid_cond_mrkt_div_code: "J", fid_input_iscd: symbol }, token);
  } catch (error) {
    console.warn(`[KIS 재무비율] ${symbol}:`, error.message);
  }
  const latest = Array.isArray(ratios) ? ratios[0] || {} : ratios || {};
  const data = {
    symbol, supported: true, source: "한국투자증권 Open API", updatedAt: new Date().toISOString(), period: latest.stac_yymm || quote.stac_month || null,
    metrics: {
      per: number(quote.per), pbr: number(quote.pbr), eps: number(quote.eps), bps: number(quote.bps), roe: number(latest.roe_val),
      marketCap: number(quote.hts_avls), listedShares: number(quote.lstn_stcn), debtRatio: number(latest.lblt_rate),
      salesGrowth: number(latest.grs), operatingGrowth: number(latest.bsop_prfi_inrt), netIncomeGrowth: number(latest.ntin_inrt),
      high250: number(quote.d250_hgpr), low250: number(quote.d250_lwpr), foreignOwnership: number(quote.hts_frgn_ehrt), volumeTurnover: number(quote.vol_tnrt),
    },
  };
  cache.set(symbol, { savedAt: Date.now(), data });
  return data;
}
