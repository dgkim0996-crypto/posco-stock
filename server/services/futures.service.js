import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";
import alternativeMarketDataService from "./alternativeMarketData.service.js";

const assetBySymbol = new Map(INITIAL_MARKETS.futures.map((asset) => [asset.symbol, asset]));
const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });

/** 계좌 ID를 안전한 양의 정수로 변환한다. */
function parseAccountId(value) {
  const accountId = Number(value);
  if (!Number.isInteger(accountId) || accountId <= 0) throw createError(400, "잘못된 계좌 ID 형식입니다.");
  return accountId;
}

/** DB 계좌 행을 API 응답용 camelCase 모델로 바꾼다. */
function mapAccount(row) {
  return { id: row.id, accountNumber: row.account_number, krwBalance: Number(row.krw_balance), usdBalance: Number(row.usd_balance) };
}

/** DB 선물 포지션 행을 화면이 사용하는 숫자형 모델로 변환한다. */
function mapPosition(row) {
  return { id: row.id, accountId: row.account_id, symbol: row.symbol, side: row.side, quantity: Number(row.quantity), entryPrice: Number(row.entry_price), multiplier: Number(row.multiplier), margin: Number(row.margin), createdAt: row.created_at };
}

/** 외부 모의 시세를 우선 사용하고, 실패 시 종목 기본 가격으로 거래를 계속할 수 있게 한다. */
async function priceFor(symbol) {
  const asset = assetBySymbol.get(symbol);
  if (!asset) throw createError(400, "지원하지 않는 선물 종목입니다.");
  try {
    const payload = await alternativeMarketDataService.loadQuotes();
    const quote = payload.items?.futures?.find((item) => item.symbol === symbol);
    if (Number.isFinite(quote?.price)) return { asset, price: quote.price };
  } catch {
    // 외부 시세 장애는 기본 가격 폴백으로 처리한다.
  }
  return { asset, price: Number(asset.price) };
}

/** RPC 오류 코드에 따라 사용자 입력 오류와 서버 오류를 구분한다. */
function translateRpcError(error) {
  if (error.code === "P0002") return createError(404, error.message, error);
  if (error.code === "P0001" || error.code === "22023") return createError(400, error.message, error);
  return createError(503, `선물 처리 실패: ${error.message}`, error);
}

/** 계좌의 모든 미결제 선물 포지션을 생성일 순으로 반환한다. */
async function getAll(accountIdValue) {
  const accountId = parseAccountId(accountIdValue);
  const { data, error } = await getSupabaseAdmin().from("futures_positions").select("*").eq("account_id", accountId).order("created_at");
  if (error) throw createError(503, `선물 포지션 조회 실패: ${error.message}`, error);
  return data.map(mapPosition);
}

/** 현재 시세·계약 승수·증거금율을 전달해 선물 포지션을 원자적으로 개설한다. */
async function open(accountIdValue, { symbol, side, quantity }) {
  const accountId = parseAccountId(accountIdValue);
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) throw createError(400, "계약 수는 1 이상의 정수여야 합니다.");
  const { asset, price } = await priceFor(symbol);
  const { data, error } = await getSupabaseAdmin().rpc("open_futures_position", { p_account_id: accountId, p_symbol: symbol, p_side: side, p_quantity: qty, p_entry_price: price, p_multiplier: asset.multiplier, p_margin_rate: asset.marginRate });
  if (error) throw translateRpcError(error);
  return { account: mapAccount(data.account), position: mapPosition(data.position) };
}

/** 계좌 소유권을 확인한 포지션을 현재가로 청산하고 정산 결과를 반환한다. */
async function close(accountIdValue, positionId) {
  const accountId = parseAccountId(accountIdValue);
  const database = getSupabaseAdmin();
  const { data: row, error: findError } = await database.from("futures_positions").select("symbol").eq("id", positionId).eq("account_id", accountId).maybeSingle();
  if (findError) throw createError(503, `선물 포지션 조회 실패: ${findError.message}`, findError);
  if (!row) throw createError(404, "선물 포지션을 찾을 수 없습니다.");
  const { price } = await priceFor(row.symbol);
  const { data, error } = await database.rpc("close_futures_position", { p_account_id: accountId, p_position_id: positionId, p_current_price: price });
  if (error) throw translateRpcError(error);
  return { account: mapAccount(data.account), position: mapPosition(data.position), pnl: Number(data.pnl), payout: Number(data.payout), currentPrice: Number(data.current_price) };
}

export default { getAll, open, close };
