import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";

const validSymbols = new Set(
  Object.values(INITIAL_MARKETS).flat().map((asset) => asset.id),
);

const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });

const validateAccountId = (value) => {
  const accountId = Number(value);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw createError(400, "잘못된 계좌 ID 형식입니다.");
  }
  return accountId;
};

const validateSymbol = (value) => {
  if (typeof value !== "string" || !validSymbols.has(value.trim())) {
    throw createError(400, "지원하지 않는 종목 코드입니다.");
  }
  return value.trim();
};

const getAll = async (accountIdValue) => {
  const accountId = validateAccountId(accountIdValue);
  const { data, error } = await getSupabaseAdmin()
    .from("favorites")
    .select("symbol")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true });

  if (error) throw createError(503, `즐겨찾기 조회 실패: ${error.message}`, error);
  return data.map((item) => item.symbol);
};

const add = async (accountIdValue, symbolValue) => {
  const accountId = validateAccountId(accountIdValue);
  const symbol = validateSymbol(symbolValue);
  const { error } = await getSupabaseAdmin()
    .from("favorites")
    .upsert({ account_id: accountId, symbol }, { onConflict: "account_id,symbol" });

  if (error) throw createError(503, `즐겨찾기 저장 실패: ${error.message}`, error);
  return { accountId, symbol };
};

const remove = async (accountIdValue, symbolValue) => {
  const accountId = validateAccountId(accountIdValue);
  const symbol = validateSymbol(symbolValue);
  const { error } = await getSupabaseAdmin()
    .from("favorites")
    .delete()
    .eq("account_id", accountId)
    .eq("symbol", symbol);

  if (error) throw createError(503, `즐겨찾기 삭제 실패: ${error.message}`, error);
  return { accountId, symbol };
};

export default { getAll, add, remove };
