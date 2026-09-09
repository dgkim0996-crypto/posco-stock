import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";
import marketDataService from "./marketData.service.js";

const PRODUCTS = ["credit", "margin", "lending", "collateral"];
const KRW_PER_USD = 1380;
const stockBySymbol = new Map(INITIAL_MARKETS.stocks.map((asset) => [asset.symbol, asset]));
const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });

/** 계좌 ID를 양의 정수로 정규화해 다른 계좌를 잘못 조회하지 않도록 한다. */
function parseAccountId(value) {
  const accountId = Number(value);
  if (!Number.isInteger(accountId) || accountId <= 0) throw createError(400, "잘못된 계좌 ID 형식입니다.");
  return accountId;
}

/** 서비스가 지원하는 금융상품 코드만 통과시킨다. */
function validateProduct(value) {
  if (!PRODUCTS.includes(value)) throw createError(400, "지원하지 않는 금융상품입니다.");
  return value;
}

/** DB 계좌 행을 프런트엔드가 사용하는 계좌 모델로 변환한다. */
function mapAccount(row) {
  return { id: row.id, accountNumber: row.account_number, krwBalance: Number(row.krw_balance), usdBalance: Number(row.usd_balance) };
}

/** DB 약정 행에서 화면에 필요한 활성·한도·부채·담보 값만 반환한다. */
function mapContract(row) {
  return { active: Boolean(row.active), limit: Number(row.limit_amount), debt: Number(row.debt), locked: Number(row.locked_amount) };
}

/** 아직 만들어지지 않은 상품도 화면에서 동일하게 다루도록 빈 약정 묶음을 만든다. */
function createEmptyContracts() {
  return Object.fromEntries(PRODUCTS.map((product) => [product, { active: false, limit: 0, debt: 0, locked: 0 }]));
}

/** 보유 주식을 실시간 시세 우선으로 평가해 신용 한도 계산에 사용할 담보 가치를 반환한다. */
async function stockValueFor(accountId) {
  const { data, error } = await getSupabaseAdmin().from("holdings").select("symbol,quantity").eq("account_id", accountId).eq("category", "stocks");
  if (error) throw createError(503, `담보 평가 조회 실패: ${error.message}`, error);
  return data.reduce((total, holding) => {
    const asset = stockBySymbol.get(holding.symbol);
    const livePrice = marketDataService.getQuote(holding.symbol)?.price;
    const nativePrice = Number.isFinite(livePrice) ? livePrice : Number(asset?.price ?? 0);
    const krwPrice = asset?.unit === "USD" ? nativePrice * KRW_PER_USD : nativePrice;
    return total + krwPrice * Number(holding.quantity);
  }, 0);
}

/** PostgreSQL RPC의 업무 오류를 사용자에게 전달할 HTTP 오류로 변환한다. */
function translateRpcError(error) {
  const knownMessages = ["계좌를 찾을 수 없습니다.", "이미 실행 중인 금융상품입니다.", "실행 가능 한도를 초과했습니다.", "대주 담보금보다 예수금이 부족합니다.", "실행 중인 금융상품이 아닙니다.", "대주잔고를 먼저 상환해야 합니다.", "상환에 필요한 현금이 부족합니다.", "실행금액은 10만원 이상이어야 합니다."];
  const message = knownMessages.find((item) => error.message.includes(item));
  const status = message?.includes("계좌를 찾을") ? 404 : message ? 400 : 503;
  return createError(status, message || `금융업무 처리 실패: ${error.message}`, error);
}

/** 계좌의 모든 금융 약정을 상품 코드별로 반환한다. */
async function getAll(accountIdValue) {
  const accountId = parseAccountId(accountIdValue);
  const { data, error } = await getSupabaseAdmin().from("finance_contracts").select("*").eq("account_id", accountId);
  if (error) throw createError(503, `금융약정 조회 실패: ${error.message}`, error);
  const contracts = createEmptyContracts();
  data.forEach((row) => { contracts[row.product_type] = mapContract(row); });
  return contracts;
}

/** 담보 평가액과 함께 금융상품 실행 RPC를 호출하고 변경된 계좌·약정을 반환한다. */
async function execute(accountIdValue, productValue, amountValue) {
  const accountId = parseAccountId(accountIdValue);
  const product = validateProduct(productValue);
  const amount = Number(amountValue);
  if (!Number.isFinite(amount) || amount < 100_000) throw createError(400, "실행금액은 10만원 이상이어야 합니다.");
  const stockValue = await stockValueFor(accountId);
  const { data, error } = await getSupabaseAdmin().rpc("execute_finance_contract", { p_account_id: accountId, p_product_type: product, p_amount: amount, p_stock_value: stockValue });
  if (error) throw translateRpcError(error);
  return { account: mapAccount(data.account), contract: mapContract(data.contract), product, maximum: Number(data.maximum) };
}

/** 선택한 금융 약정을 전액 정산하고 최신 계좌·약정 상태를 반환한다. */
async function settle(accountIdValue, productValue) {
  const accountId = parseAccountId(accountIdValue);
  const product = validateProduct(productValue);
  const { data, error } = await getSupabaseAdmin().rpc("settle_finance_contract", { p_account_id: accountId, p_product_type: product });
  if (error) throw translateRpcError(error);
  return { account: mapAccount(data.account), contract: mapContract(data.contract), product };
}

export default { getAll, execute, settle };
