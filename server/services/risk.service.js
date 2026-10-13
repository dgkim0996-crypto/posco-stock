import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";
import { SIMULATED_USD_KRW } from "../../shared/tradingRules.js";
import marketDataService from "./marketData.service.js";
import alternativeMarketDataService, { futuresQuoteState } from "./alternativeMarketData.service.js";

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1_000;
const MONITOR_INTERVAL_MS = 10_000;
const stockBySymbol = new Map(INITIAL_MARKETS.stocks.map((asset) => [asset.symbol, asset]));
// risk_policies 행이 없을 때 쓰는 018 기본 정책.
const DEFAULT_POLICIES = {
  FUTURES: { warning: 0.85, marginCall: 0.75, liquidation: 0.5 },
  FINANCE: { warning: 1.5, marginCall: 1.4, liquidation: 1.2 },
};

/** 업무 오류를 HTTP 오류 처리기가 이해할 수 있는 형태로 만든다. */
const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });
const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);

/** 계좌 식별자를 양의 정수로 정규화해 잘못된 DB 조회를 막는다. */
function parseAccountId(value) {
  const accountId = Number(value);
  if (!Number.isInteger(accountId) || accountId <= 0) throw createError(400, "잘못된 계좌 ID입니다.");
  return accountId;
}

/**
 * 선물 한 포지션을 평가한다. 시세 수신이 끊긴 종목은 마지막 수신가(없으면 진입가)로 표시만 하고
 * markable=false로 표시해 위험 기록과 강제청산에서 제외한다. 정적 기준가는 쓰지 않는다.
 */
export function evaluateFuturesPosition(position, quote, now = Date.now()) {
  const state = futuresQuoteState(quote, now);
  const lastKnown = Number(quote?.price);
  const currentPrice = state.markable ? state.price : lastKnown > 0 && Number.isFinite(lastKnown) ? lastKnown : Number(position.entry_price);
  const direction = position.side === "LONG" ? 1 : -1;
  const margin = Number(position.margin);
  const pnl = (currentPrice - Number(position.entry_price)) * Number(position.multiplier) * Number(position.quantity) * direction;
  const equity = margin + pnl;
  return {
    id: position.id, symbol: position.symbol, side: position.side, quantity: Number(position.quantity), currentPrice, pnl, equity, margin,
    ratio: margin > 0 ? equity / margin : null, markable: state.markable, tradable: state.tradable, quoteStatus: state.reason || "FRESH",
  };
}

/**
 * 선물 평가손익과 현금·주식·신용 의무를 하나의 계좌 순자산으로 합산하고, 위험단계·부족액·위험비율을
 * 같은 요구액(선물 개시증거금×선물 기준 + 금융 의무×금융 기준)으로 판정한다.
 * MARGIN_CALL 이상이면 항상 부족액이 0보다 크다.
 */
export function assessAccountRisk({ cash, stockValue = 0, shortValue = 0, debt = 0, locked = 0, positions = [], policies = {} }) {
  const futuresPolicy = { ...DEFAULT_POLICIES.FUTURES, ...policies.FUTURES };
  const financePolicy = { ...DEFAULT_POLICIES.FINANCE, ...policies.FINANCE };
  const futuresMargin = sum(positions, (position) => position.margin);
  const futuresEquity = sum(positions, (position) => position.equity);
  const obligation = debt + shortValue;
  const financeEquity = cash + stockValue + locked;
  const equity = futuresEquity + financeEquity;
  const requirementAt = (level) => futuresMargin * futuresPolicy[level] + obligation * financePolicy[level];
  const required = { warning: requirementAt("warning"), marginCall: requirementAt("marginCall"), liquidation: requirementAt("liquidation") };
  const status = !(required.marginCall > 0) ? "SAFE"
    : equity < required.liquidation ? "LIQUIDATION"
      : equity < required.marginCall ? "MARGIN_CALL"
        : equity < required.warning ? "WARNING" : "SAFE";
  const requiredMargin = required.marginCall;
  return {
    status, equity, requiredMargin, deficit: Math.max(0, requiredMargin - equity), marginRatio: requiredMargin > 0 ? equity / requiredMargin : null,
    quotesComplete: positions.every((position) => position.markable),
    details: {
      basis: "ACCOUNT_EQUITY",
      required,
      futures: { equity: futuresEquity, initialMargin: futuresMargin, pnl: futuresEquity - futuresMargin, ratio: futuresMargin ? futuresEquity / futuresMargin : null, positions },
      finance: { equity: financeEquity, obligation, ratio: obligation ? financeEquity / obligation : null, cash, stockValue, shortValue, debt, locked },
    },
  };
}

/**
 * 청산단계 계좌에서 거래 가능한 포지션을 증거금 비율이 나쁜 순서로 골라, 부족액이 해소될 때까지 정리할 목록을 만든다.
 * 예수금을 넘는 손실은 DB가 미수 부채로 기록하므로 계획에도 같은 방식으로 반영한다.
 */
export function planLiquidation(inputs, assessment = assessAccountRisk(inputs)) {
  if (assessment.status !== "LIQUIDATION" || !assessment.quotesComplete) return [];
  const plan = [];
  let state = inputs;
  let current = assessment;
  for (const position of inputs.positions.filter((item) => item.tradable).sort((left, right) => left.ratio - right.ratio)) {
    if (current.deficit <= 0) break;
    const cashAfter = state.cash + position.equity;
    state = {
      ...state, cash: Math.max(0, cashAfter), debt: (state.debt || 0) + Math.max(0, -cashAfter),
      positions: state.positions.filter((item) => item.id !== position.id),
    };
    plan.push(position);
    current = assessAccountRisk(state);
  }
  return plan;
}

/** 보유 현물 또는 대주 잔고를 실시간 시세 우선으로 원화 평가한다. */
function valueSpotPositions(rows, stockQuote, useAverageFallback = false) {
  return rows.reduce((total, row) => {
    const asset = stockBySymbol.get(row.symbol);
    const livePrice = stockQuote(row.symbol)?.price;
    const fallback = useAverageFallback ? row.avg_price : 0;
    const price = Number.isFinite(livePrice) ? livePrice : Number(asset?.price || fallback);
    return total + price * (asset?.unit === "USD" ? SIMULATED_USD_KRW : 1) * Number(row.quantity);
  }, 0);
}

/** 위험 등급 변경 또는 정기 기록 시점인지 판단해 불필요한 스냅샷 생성을 막는다. */
function needsSnapshot(latestSnapshot, status, now) {
  return !latestSnapshot || latestSnapshot.status !== status
    || now - new Date(latestSnapshot.created_at).getTime() >= SNAPSHOT_INTERVAL_MS;
}

const mapPositionRow = (row) => ({ id: row.id, symbol: row.symbol, side: row.side, quantity: Number(row.quantity), entryPrice: Number(row.entry_price), multiplier: Number(row.multiplier), margin: Number(row.margin), createdAt: row.created_at });

async function evaluateAccount(accountId, {
  database = getSupabaseAdmin(), quotes = alternativeMarketDataService,
  stockQuote = (symbol) => marketDataService.getQuote(symbol), now = Date.now,
} = {}) {
  const [account, positions, contracts, holdings, shorts, policies, futureQuotes] = await Promise.all([
    database.from("accounts").select("*").eq("id", accountId).single(),
    database.from("futures_positions").select("*").eq("account_id", accountId),
    database.from("finance_contracts").select("*").eq("account_id", accountId).eq("active", true),
    database.from("holdings").select("symbol,quantity").eq("account_id", accountId).eq("category", "stocks"),
    database.from("short_positions").select("symbol,quantity,avg_price").eq("account_id", accountId),
    database.from("risk_policies").select("*"),
    quotes.loadQuotes().catch(() => quotes.getCachedQuotes() || { items: { futures: [] } }),
  ]);
  const failedQuery = [account, positions, contracts, holdings, shorts, policies].find((result) => result.error);
  if (failedQuery) throw createError(503, `위험 평가 조회 실패: ${failedQuery.error.message}`, failedQuery.error);

  const evaluatedAt = now();
  const policyByCode = Object.fromEntries(policies.data.map((row) => [row.code, {
    warning: Number(row.warning_ratio), marginCall: Number(row.margin_call_ratio), liquidation: Number(row.liquidation_ratio),
  }]));
  const quoteBySymbol = new Map((futureQuotes?.items?.futures || []).map((item) => [item.symbol, item]));
  const inputs = {
    cash: Number(account.data.krw_balance),
    stockValue: valueSpotPositions(holdings.data, stockQuote),
    shortValue: valueSpotPositions(shorts.data, stockQuote, true),
    debt: sum(contracts.data, (contract) => Number(contract.debt || 0)),
    locked: sum(contracts.data, (contract) => Number(contract.locked_amount || 0)),
    positions: positions.data.map((position) => evaluateFuturesPosition(position, quoteBySymbol.get(position.symbol), evaluatedAt)),
    policies: policyByCode,
  };
  const assessment = assessAccountRisk(inputs);
  const { status, equity, requiredMargin, deficit, marginRatio, details, quotesComplete } = assessment;

  // 시세 수신이 끊긴 포지션이 있으면 계좌 순자산을 확정할 수 없으므로 기록·청산을 모두 건너뛴다.
  if (quotesComplete) {
    const latest = await database.from("risk_snapshots").select("status,created_at").eq("account_id", accountId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (latest.error) throw createError(503, `최근 위험 상태 조회 실패: ${latest.error.message}`, latest.error);
    if (needsSnapshot(latest.data, status, evaluatedAt)) {
      const snapshot = await database.rpc("record_risk_snapshot", { p_account_id: accountId, p_status: status, p_equity: equity, p_required_margin: requiredMargin, p_margin_ratio: marginRatio, p_deficit: deficit, p_details: details });
      if (snapshot.error) throw createError(503, `위험 스냅샷 기록 실패: ${snapshot.error.message}`, snapshot.error);
    }
  }

  const liquidations = [];
  const liquidationFailures = [];
  for (const position of planLiquidation(inputs, assessment)) {
    const result = await database.rpc("force_liquidate_futures_position", { p_account_id: accountId, p_position_id: position.id, p_current_price: position.currentPrice });
    // 다른 요청이 먼저 청산한 포지션은 건너뛴다.
    if (result.error?.code === "P0002") continue;
    if (result.error) { liquidationFailures.push({ positionId: position.id, symbol: position.symbol, error: result.error.message }); continue; }
    liquidations.push({
      positionId: position.id, symbol: position.symbol, pnl: Number(result.data.pnl), payout: Number(result.data.payout), deficit: Number(result.data.deficit),
      cancelledPendingOrders: (result.data.cancelled_pending_orders || []).length,
    });
  }

  const [finalAccount, remaining] = await Promise.all([
    database.from("accounts").select("krw_balance").eq("id", accountId).single(),
    database.from("futures_positions").select("*").eq("account_id", accountId).order("created_at"),
  ]);
  if (finalAccount.error || remaining.error) throw createError(503, "위험 평가 후 계좌 상태를 읽지 못했습니다.", finalAccount.error || remaining.error);
  return {
    status, equity, requiredMargin, deficit, marginRatio, details, quotesComplete, liquidations,
    ...(liquidationFailures.length ? { liquidationFailures } : {}),
    unpricedSymbols: [...new Set(inputs.positions.filter((position) => !position.markable).map((position) => position.symbol))],
    account: { krwBalance: Number(finalAccount.data.krw_balance) },
    futuresPositions: remaining.data.map(mapPositionRow),
  };
}

const inFlight = new Map();

/**
 * 계좌의 선물·신용 위험을 계산하고, 청산단계이면 신선한 시세가 있는 선물을 원자적으로 강제청산한다.
 * 같은 계좌의 동시 평가(화면 조회·주기 감시)는 하나의 실행을 공유한다.
 * @param {number|string} accountIdValue 인증 미들웨어 또는 감시 작업이 결정한 계좌 ID
 */
async function evaluate(accountIdValue, options) {
  const accountId = parseAccountId(accountIdValue);
  if (inFlight.has(accountId)) return inFlight.get(accountId);
  const task = evaluateAccount(accountId, options).finally(() => inFlight.delete(accountId));
  inFlight.set(accountId, task);
  return task;
}

/**
 * 브라우저 접속과 무관하게 선물 보유 계좌를 주기적으로 평가해 강제청산한다.
 * account_id 커서로 순회해 처리 예산을 넘는 계좌도 다음 주기에 이어서 확인한다.
 */
export function createRiskMonitor({
  database = getSupabaseAdmin, evaluateAccount: evaluateOne = evaluate, enabled = isSupabaseEnabled,
  now = Date.now, maxAccounts = 50, budgetMs = 5_000, intervalMs = MONITOR_INTERVAL_MS, logger = console,
} = {}) {
  let cursor = 0;
  let timer = null;
  let stopped = true;
  let lastStatus = { status: "idle", checked: 0, liquidated: 0 };

  async function runOnce() {
    const started = now();
    const rowLimit = maxAccounts * 10;
    const { data, error } = await database().from("futures_positions").select("account_id")
      .gt("account_id", cursor).order("account_id", { ascending: true }).limit(rowLimit);
    if (error) throw new Error(`위험감시 대상 조회 실패: ${error.message}`);
    const distinct = [...new Set(data.map((row) => Number(row.account_id)))];
    const accountIds = distinct.slice(0, maxAccounts);
    const result = { status: "ok", checked: 0, liquidated: 0, failures: 0 };
    for (const accountId of accountIds) {
      if (result.checked > 0 && now() - started >= budgetMs) break;
      cursor = accountId;
      result.checked += 1;
      try {
        const evaluation = await evaluateOne(accountId);
        result.liquidated += evaluation.liquidations.length;
        if (evaluation.liquidations.length) {
          const receivable = sum(evaluation.liquidations, (item) => item.deficit);
          logger.warn(`계좌 ${accountId}: 선물 ${evaluation.liquidations.length}건 강제청산${receivable > 0 ? ` · 미수 ${receivable.toLocaleString("ko-KR")}원` : ""}`);
        }
        if (evaluation.liquidationFailures?.length) {
          result.failures += evaluation.liquidationFailures.length;
          result.error = evaluation.liquidationFailures[0].error;
        }
      } catch (evaluationError) {
        result.failures += 1;
        result.error = evaluationError.message;
      }
    }
    // 조회된 마지막 계좌까지 모두 확인했으면 처음 계좌부터 다시 순회한다.
    if (data.length < rowLimit && distinct.length === accountIds.length && result.checked === accountIds.length) cursor = 0;
    if (result.failures) result.status = "degraded";
    lastStatus = { ...result, updatedAt: new Date(now()).toISOString() };
    return lastStatus;
  }

  const tick = async () => {
    try {
      await runOnce();
    } catch (error) {
      lastStatus = { status: "degraded", checked: 0, liquidated: 0, error: error.message, updatedAt: new Date(now()).toISOString() };
      logger.error("선물 위험감시 주기 실패:", error.message);
    } finally {
      if (!stopped) { timer = setTimeout(tick, intervalMs); timer.unref?.(); }
    }
  };
  const start = () => { if (!stopped || !enabled()) return; stopped = false; tick().catch(() => undefined); };
  const stop = () => { stopped = true; if (timer) clearTimeout(timer); timer = null; };
  return { runOnce, start, stop, getStatus: () => lastStatus };
}

const monitor = createRiskMonitor();

export default { evaluate, startMonitor: monitor.start, stopMonitor: monitor.stop, getMonitorStatus: monitor.getStatus };
