import { getSupabaseAdmin } from "../lib/supabase.js";

const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });
const validateAccountId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw createError(400, "잘못된 계좌 ID입니다.");
  return id;
};
const mapSettlement = (row) => ({
  id: row.id, orderId: row.order_id, symbol: row.symbol, side: row.side,
  tradeDate: row.trade_date, settlementDate: row.settlement_date,
  grossAmount: Number(row.gross_amount), feeAmount: Number(row.fee_amount), taxAmount: Number(row.tax_amount),
  netAmount: Number(row.net_amount), status: row.status, settledAt: row.settled_at, createdAt: row.created_at,
});

const getAll = async (accountIdValue) => {
  const accountId = validateAccountId(accountIdValue);
  const processed = await getSupabaseAdmin().rpc("process_due_trade_settlements", { p_account_id: accountId });
  if (processed.error) throw createError(503, `결제 처리 실패: ${processed.error.message}`, processed.error);
  const { data, error } = await getSupabaseAdmin().from("trade_settlements").select("*")
    .eq("account_id", accountId).order("created_at", { ascending: false }).limit(200);
  if (error) throw createError(503, `결제 예정내역 조회 실패: ${error.message}`, error);
  return { items: data.map(mapSettlement), processed: Number(processed.data || 0) };
};

const getPolicies = async () => {
  const { data, error } = await getSupabaseAdmin().from("trade_charge_policies").select("*").order("code");
  if (error) throw createError(503, `수수료 정책 조회 실패: ${error.message}`, error);
  return data.map((row) => ({ code: row.code, name: row.name, feeRate: Number(row.fee_rate), sellTaxRate: Number(row.sell_tax_rate), settlementDays: row.settlement_days }));
};

export default { getAll, getPolicies };
