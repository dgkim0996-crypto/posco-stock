import { createAdvisorAnalysis, createFundamentalAnalysis } from "../services/advisor.service.js";

const createError = (status, message) => Object.assign(new Error(message), { status });
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// 외부 AI 프롬프트로 전달되는 문자열은 제어문자를 지우고 길이를 제한한다.
const cleanText = (value, maxLength) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength)
  : "";
const finiteIn = (value, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : null;
};
const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;

// 화면이 보내는 필드만 허용 목록으로 다시 만들어 임의 필드와 과대 입력이 AI 요청에 섞이지 않게 한다.
const normalizeIndex = (item) => {
  if (!isPlainObject(item)) return null;
  const name = cleanText(item.name, 30);
  const value = finiteIn(item.value, 0, 1e9);
  const change = finiteIn(item.change, -100, 100);
  return name && change !== null ? { name, value, change } : null;
};

const normalizeCandidate = (item) => {
  if (!isPlainObject(item)) return null;
  const symbol = cleanText(item.symbol, 20);
  const name = cleanText(item.name, 60);
  const change = finiteIn(item.change, -100, 1_000);
  if (!SYMBOL_PATTERN.test(symbol) || !name || change === null) return null;
  return {
    symbol,
    name,
    market: cleanText(item.market, 20) || null,
    group: cleanText(item.group, 20) || null,
    price: finiteIn(item.price, 0, 1e12),
    change,
    volume: finiteIn(item.volume, 0, 1e15),
    strength: finiteIn(item.strength, 0, 1_000),
  };
};

function validateAnalysisInput(input) {
  if (!isPlainObject(input)) throw createError(400, "분석 요청 형식이 올바르지 않습니다.");
  if (! ["pension", "isa", "retirement", "wrap"].includes(input.product)) throw createError(400, "지원하지 않는 상품입니다.");
  if (! ["conservative", "balanced", "growth"].includes(input.profile)) throw createError(400, "지원하지 않는 투자성향입니다.");
  if (!Array.isArray(input.indices) || input.indices.length > 20) throw createError(400, "지수 데이터는 20개 이하로 보내야 합니다.");
  if (!Array.isArray(input.candidates) || input.candidates.length < 3 || input.candidates.length > 40) {
    throw createError(400, "분석 후보는 3개 이상 40개 이하로 보내야 합니다.");
  }
  const indices = input.indices.map(normalizeIndex).filter(Boolean);
  const seen = new Set();
  const candidates = input.candidates.map(normalizeCandidate).filter((item) => {
    if (!item || seen.has(item.symbol)) return false;
    seen.add(item.symbol);
    return true;
  });
  if (candidates.length < 3) throw createError(400, "분석할 수 있는 후보 종목이 3개 이상 필요합니다.");
  return { product: input.product, profile: input.profile, indices, candidates };
}

export async function createAdvisor(req, res, next) {
  try { res.json(await createAdvisorAnalysis(validateAnalysisInput(req.body))); } catch (error) { next(error); }
}

const FUNDAMENTAL_KEYS = new Set(["per", "pbr", "roe", "eps", "bps", "marketCap", "listedShares", "debtRatio", "foreignOwnership", "salesGrowth", "operatingGrowth", "netIncomeGrowth", "volumeTurnover", "high250", "low250"]);

function validateFundamentalInput(input) {
  if (!isPlainObject(input)) throw createError(400, "분석 요청 형식이 올바르지 않습니다.");
  if (!/^\d{6}$/.test(String(input.symbol || ""))) throw createError(400, "국내주식 종목코드가 올바르지 않습니다.");
  const name = cleanText(input.name, 80);
  if (!name) throw createError(400, "종목명이 올바르지 않습니다.");
  if (!isPlainObject(input.metrics)) throw createError(400, "재무지표가 올바르지 않습니다.");
  const metrics = {};
  for (const [key, value] of Object.entries(input.metrics)) {
    if (!FUNDAMENTAL_KEYS.has(key)) continue;
    if (value !== null && (!Number.isFinite(value) || Math.abs(value) > 1e16)) throw createError(400, `${key} 지표가 올바르지 않습니다.`);
    metrics[key] = value;
  }
  if (!Object.values(metrics).some(Number.isFinite)) throw createError(400, "분석할 수 있는 재무지표가 없습니다.");
  return {
    symbol: String(input.symbol),
    name,
    period: cleanText(input.period, 20) || null,
    source: cleanText(input.source, 80) || null,
    metrics,
  };
}

export async function createFundamentalAdvisor(req, res, next) {
  try { res.json(await createFundamentalAnalysis(validateFundamentalInput(req.body))); } catch (error) { next(error); }
}
