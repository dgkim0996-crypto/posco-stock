import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";
import marketDataService from "./marketData.service.js";
import alternativeMarketDataService from "./alternativeMarketData.service.js";

const KRW_PER_USD = 1380;
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1_000;
const stockBySymbol = new Map(INITIAL_MARKETS.stocks.map((asset) => [asset.symbol, asset]));
const futureBySymbol = new Map(INITIAL_MARKETS.futures.map((asset) => [asset.symbol, asset]));
const severityByStatus = { SAFE: 0, WARNING: 1, MARGIN_CALL: 2, LIQUIDATION: 3 };

/** 업무 오류를 HTTP 오류 처리기가 이해할 수 있는 형태로 만든다. */
const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });

/** 계좌 식별자를 양의 정수로 정규화해 잘못된 DB 조회를 막는다. */
function parseAccountId(value) {
  const accountId = Number(value);
  if (!Number.isInteger(accountId) || accountId <= 0) throw createError(400, "잘못된 계좌 ID입니다.");
  return accountId;
}

/** 증거금 비율과 정책 임계값에서 사용자에게 보여 줄 위험 단계를 결정한다. */
function statusFor(ratio, policy) {
  if (ratio == null) return "SAFE";
  if (ratio <= policy.liquidation) return "LIQUIDATION";
  if (ratio <= policy.marginCall) return "MARGIN_CALL";
  if (ratio <= policy.warning) return "WARNING";
  return "SAFE";
}

/** 선물 한 계약의 현재가·방향·진입가로 평가손익과 증거금 비율을 계산한다. */
function evaluateFuturesPosition(position, prices, policy) {
  const fallback = futureBySymbol.get(position.symbol);
  const currentPrice = prices.get(position.symbol) || Number(fallback?.price) || Number(position.entry_price);
  const direction = position.side === "LONG" ? 1 : -1;
  const margin = Number(position.margin);
  const pnl = (currentPrice - Number(position.entry_price)) * Number(position.multiplier) * Number(position.quantity) * direction;
  const equity = margin + pnl;
  const ratio = margin > 0 ? equity / margin : null;
  return { id: position.id, symbol: position.symbol, side: position.side, currentPrice, pnl, equity, margin, ratio, status: statusFor(ratio, policy) };
}

/** 보유 현물 또는 대주 잔고를 실시간 시세 우선으로 원화 평가한다. */
function valueSpotPositions(rows, useAverageFallback = false) {
  return rows.reduce((total, row) => {
    const asset = stockBySymbol.get(row.symbol);
    const livePrice = marketDataService.getQuote(row.symbol)?.price;
    const fallback = useAverageFallback ? row.avg_price : 0;
    const price = Number.isFinite(livePrice) ? livePrice : Number(asset?.price || fallback);
    return total + price * (asset?.unit === "USD" ? KRW_PER_USD : 1) * Number(row.quantity);
  }, 0);
}

/** 위험 등급 변경 또는 정기 기록 시점인지 판단해 불필요한 스냅샷 생성을 막는다. */
function needsSnapshot(latestSnapshot, status) {
  return !latestSnapshot || latestSnapshot.status !== status
    || Date.now() - new Date(latestSnapshot.created_at).getTime() >= SNAPSHOT_INTERVAL_MS;
}

/**
 * 계좌의 선물·신용 위험을 계산하고, 청산 기준인 선물을 원자적으로 강제청산한다.
 * @param {number|string} accountIdValue 인증 미들웨어가 결정한 계좌 ID
 * @param {{ autoLiquidate?: boolean }} options 자동 청산 실행 여부
 */
async function evaluate(accountIdValue, { autoLiquidate = true } = {}) {
  const accountId = parseAccountId(accountIdValue);
  const database = getSupabaseAdmin();
  const [account, positions, contracts, holdings, shorts, policies, futureQuotes] = await Promise.all([
    database.from("accounts").select("*").eq("id", accountId).single(),
    database.from("futures_positions").select("*").eq("account_id", accountId),
    database.from("finance_contracts").select("*").eq("account_id", accountId).eq("active", true),
    database.from("holdings").select("symbol,quantity").eq("account_id", accountId).eq("category", "stocks"),
    database.from("short_positions").select("symbol,quantity,avg_price").eq("account_id", accountId),
    database.from("risk_policies").select("*"),
    alternativeMarketDataService.loadQuotes().catch(() => ({ items: { futures: [] } })),
  ]);
  const failedQuery = [account, positions, contracts, holdings, shorts, policies].find((result) => result.error);
  if (failedQuery) throw createError(503, `위험 평가 조회 실패: ${failedQuery.error.message}`, failedQuery.error);

  const policyByCode = Object.fromEntries(policies.data.map((row) => [row.code, {
    warning: Number(row.warning_ratio), marginCall: Number(row.margin_call_ratio), liquidation: Number(row.liquidation_ratio),
  }]));
  const futurePrices = new Map((futureQuotes.items?.futures || []).map((item) => [item.symbol, Number(item.price)]));
  const positionRisks = positions.data.map((position) => evaluateFuturesPosition(position, futurePrices, policyByCode.FUTURES));
  const futuresMargin = positionRisks.reduce((total, position) => total + position.margin, 0);
  const futuresEquity = positionRisks.reduce((total, position) => total + position.equity, 0);
  const futuresRatio = futuresMargin ? futuresEquity / futuresMargin : null;
  const stockValue = valueSpotPositions(holdings.data);
  const shortValue = valueSpotPositions(shorts.data, true);
  const debt = contracts.data.reduce((total, contract) => total + Number(contract.debt || 0), 0);
  const locked = contracts.data.reduce((total, contract) => total + Number(contract.locked_amount || 0), 0);
  const obligation = debt + shortValue;
  const financeEquity = Number(account.data.krw_balance) + stockValue + locked;
  const financeRatio = obligation ? financeEquity / obligation : null;
  const futuresStatus = statusFor(futuresRatio, policyByCode.FUTURES);
  const financeStatus = statusFor(financeRatio, policyByCode.FINANCE);
  const status = severityByStatus[futuresStatus] >= severityByStatus[financeStatus] ? futuresStatus : financeStatus;
  const requiredMargin = futuresMargin * (policyByCode.FUTURES?.marginCall || 0.75) + obligation * (policyByCode.FINANCE?.marginCall || 1.4);
  const equity = futuresEquity + financeEquity;
  const deficit = Math.max(0, requiredMargin - equity);
  const details = {
    futures: { status: futuresStatus, equity: futuresEquity, initialMargin: futuresMargin, ratio: futuresRatio, positions: positionRisks },
    finance: { status: financeStatus, equity: financeEquity, obligation, ratio: financeRatio, stockValue, shortValue, debt, locked },
  };

  const latest = await database.from("risk_snapshots").select("status,created_at").eq("account_id", accountId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw createError(503, `최근 위험 상태 조회 실패: ${latest.error.message}`, latest.error);
  if (needsSnapshot(latest.data, status)) {
    const snapshot = await database.rpc("record_risk_snapshot", { p_account_id: accountId, p_status: status, p_equity: equity, p_required_margin: requiredMargin, p_margin_ratio: requiredMargin ? equity / requiredMargin : null, p_deficit: deficit, p_details: details });
    if (snapshot.error) throw createError(503, `위험 스냅샷 기록 실패: ${snapshot.error.message}`, snapshot.error);
  }

  const liquidations = [];
  if (autoLiquidate && futuresStatus === "LIQUIDATION") {
    for (const position of positionRisks.filter((item) => item.status === "LIQUIDATION")) {
      const result = await database.rpc("force_liquidate_futures_position", { p_account_id: accountId, p_position_id: position.id, p_current_price: position.currentPrice });
      if (result.error) throw createError(503, `강제청산 실패: ${result.error.message}`, result.error);
      liquidations.push({ positionId: position.id, symbol: position.symbol, pnl: Number(result.data.pnl), payout: Number(result.data.payout), deficit: Number(result.data.deficit) });
    }
  }

  const [finalAccount, remaining] = await Promise.all([
    database.from("accounts").select("krw_balance").eq("id", accountId).single(),
    database.from("futures_positions").select("*").eq("account_id", accountId).order("created_at"),
  ]);
  if (finalAccount.error || remaining.error) throw createError(503, "위험 평가 후 계좌 상태를 읽지 못했습니다.", finalAccount.error || remaining.error);
  return {
    status, equity, requiredMargin, deficit, details, liquidations,
    account: { krwBalance: Number(finalAccount.data.krw_balance) },
    futuresPositions: remaining.data.map((row) => ({ id: row.id, symbol: row.symbol, side: row.side, quantity: Number(row.quantity), entryPrice: Number(row.entry_price), multiplier: Number(row.multiplier), margin: Number(row.margin), createdAt: row.created_at })),
  };
}

export default { evaluate };
