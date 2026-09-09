import { getSupabaseAdmin } from "../lib/supabase.js";
import { INITIAL_MARKETS } from "../../src/data/markets.js";
import marketDataService from "./marketData.service.js";

const PRODUCTS = ["credit", "margin", "lending", "collateral"];
const stockMap = new Map(INITIAL_MARKETS.stocks.map((asset) => [asset.symbol, asset]));
const createError = (status, message, cause) => Object.assign(new Error(message), { status, cause });

const validateAccountId = (value) => {
  const id = Number(value); if (!Number.isInteger(id) || id<=0) throw createError(400,"잘못된 계좌 ID 형식입니다."); return id;
};
const validateProduct = (value) => { if (!PRODUCTS.includes(value)) throw createError(400,"지원하지 않는 금융상품입니다."); return value; };
const mapAccount = (row) => ({ id:row.id, accountNumber:row.account_number, krwBalance:Number(row.krw_balance), usdBalance:Number(row.usd_balance) });
const mapContract = (row) => ({ active:Boolean(row.active), limit:Number(row.limit_amount), debt:Number(row.debt), locked:Number(row.locked_amount) });
const emptyContracts = () => Object.fromEntries(PRODUCTS.map((key)=>[key,{active:false,limit:0,debt:0,locked:0}]));

const stockValueFor = async (accountId) => {
  const {data,error}=await getSupabaseAdmin().from("holdings").select("symbol,quantity").eq("account_id",accountId).eq("category","stocks");
  if(error) throw createError(503,`담보 평가 조회 실패: ${error.message}`,error);
  return data.reduce((sum,row)=>{const asset=stockMap.get(row.symbol);const live=marketDataService.getQuote(row.symbol)?.price;const native=Number.isFinite(live)?live:Number(asset?.price??0);const krw=asset?.unit==="USD"?native*1380:native;return sum+krw*Number(row.quantity);},0);
};
const translateRpcError = (error) => {
  const known=["계좌를 찾을 수 없습니다.","이미 실행 중인 금융상품입니다.","실행 가능 한도를 초과했습니다.","대주 담보금보다 예수금이 부족합니다.","실행 중인 금융상품이 아닙니다.","대주잔고를 먼저 상환해야 합니다.","상환에 필요한 현금이 부족합니다.","실행금액은 10만원 이상이어야 합니다."];
  const message=known.find((item)=>error.message.includes(item)); return createError(message?(message.includes("계좌를 찾을")?404:400):503,message||`금융업무 처리 실패: ${error.message}`,error);
};

const getAll = async (accountIdValue) => {
  const accountId=validateAccountId(accountIdValue); const {data,error}=await getSupabaseAdmin().from("finance_contracts").select("*").eq("account_id",accountId);
  if(error) throw createError(503,`금융약정 조회 실패: ${error.message}`,error); const result=emptyContracts(); data.forEach((row)=>{result[row.product_type]=mapContract(row);}); return result;
};
const execute = async (accountIdValue,productValue,amountValue) => {
  const accountId=validateAccountId(accountIdValue); const product=validateProduct(productValue); const amount=Number(amountValue);
  if(!Number.isFinite(amount)||amount<100000) throw createError(400,"실행금액은 10만원 이상이어야 합니다.");
  const stockValue=await stockValueFor(accountId); const {data,error}=await getSupabaseAdmin().rpc("execute_finance_contract",{p_account_id:accountId,p_product_type:product,p_amount:amount,p_stock_value:stockValue});
  if(error) throw translateRpcError(error); return {account:mapAccount(data.account),contract:mapContract(data.contract),product,maximum:Number(data.maximum)};
};
const settle = async (accountIdValue,productValue) => {
  const accountId=validateAccountId(accountIdValue); const product=validateProduct(productValue); const {data,error}=await getSupabaseAdmin().rpc("settle_finance_contract",{p_account_id:accountId,p_product_type:product});
  if(error) throw translateRpcError(error); return {account:mapAccount(data.account),contract:mapContract(data.contract),product};
};
export default {getAll,execute,settle};
