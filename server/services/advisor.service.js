const scoreCandidate = (item) => {
  const momentum = Math.max(-4, Math.min(4, Number(item.change) || 0));
  const strength = Number(item.strength) || 100;
  const etfBonus = item.group === "ETF" ? 8 : 0;
  return Math.round(55 + momentum * 7 + (strength - 100) * 0.18 + etfBonus);
};

const fallbackAnalysis = ({ candidates = [], indices = [], profile = "balanced" }) => {
  const ranked = candidates.map((item) => ({ ...item, score: scoreCandidate(item) })).sort((a, b) => b.score - a.score).slice(0, 5);
  const indexTone = indices.filter((item) => item.name !== "USD/KRW").reduce((sum, item) => sum + (Number(item.change) || 0), 0);
  const tone = indexTone >= 1 ? "위험선호 우위" : indexTone <= -1 ? "방어적 대응 필요" : "중립적 순환매 구간";
  return {
    source: "market-model",
    marketSummary: `현재 주요 지수 흐름은 ${tone}으로 분석됩니다. 단기 등락과 추정 체결강도를 함께 보되 장기계좌에서는 분산과 정기 리밸런싱을 우선합니다.`,
    horizons: {
      short: "1~4주는 변동성이 커질 수 있어 분할 진입과 손실 한도 관리가 필요합니다.",
      medium: "3~12개월은 이익 모멘텀과 지수 추세가 유지되는 우량주·ETF 중심 접근이 적합합니다.",
      long: "3년 이상은 저비용 지수 ETF와 현금흐름이 안정적인 자산을 중심으로 복리 효과를 추구합니다.",
    },
    recommendations: ranked.map((item, index) => ({
      symbol: item.symbol, name: item.name, score: Math.max(40, Math.min(95, item.score)),
      weight: [30, 25, 20, 15, 10][index], horizon: index < 2 ? "중·장기" : "분산",
      reason: `${item.change >= 0 ? "가격 모멘텀" : "조정 후 회복 가능성"}과 체결강도 ${Math.round(item.strength || 100)}를 종합한 ${profile}형 후보입니다.`,
      risk: "시장 급변·실적 변화 시 예상과 다른 손실이 발생할 수 있습니다.",
    })),
  };
};

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    marketSummary: { type: "string" },
    horizons: { type: "object", additionalProperties: false, properties: { short: { type: "string" }, medium: { type: "string" }, long: { type: "string" } }, required: ["short", "medium", "long"] },
    recommendations: { type: "array", minItems: 3, maxItems: 5, items: { type: "object", additionalProperties: false, properties: { symbol: { type: "string" }, name: { type: "string" }, score: { type: "number" }, weight: { type: "number" }, horizon: { type: "string" }, reason: { type: "string" }, risk: { type: "string" } }, required: ["symbol", "name", "score", "weight", "horizon", "reason", "risk"] } },
  },
  required: ["marketSummary", "horizons", "recommendations"],
};

const extractText = (payload) => payload?.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;

const fundamentalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    opinion: { type: "string", enum: ["적극 관심", "관심", "중립", "주의", "적극 주의"] },
    score: { type: "number" },
    summary: { type: "string" },
    positives: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    cautions: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    metricReads: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { label: { type: "string" }, interpretation: { type: "string" } },
        required: ["label", "interpretation"],
      },
    },
  },
  required: ["opinion", "score", "summary", "positives", "cautions", "metricReads"],
};

const finite = (value) => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const signedDescription = (label, value) => value >= 0
  ? `${label} ${value.toFixed(1)}%로 성장 흐름이 플러스입니다.`
  : `${label} ${value.toFixed(1)}%로 최근 성장 흐름이 둔화됐습니다.`;

function fallbackFundamentalAnalysis({ name, period, metrics = {} }) {
  const per = finite(metrics.per);
  const pbr = finite(metrics.pbr);
  const roe = finite(metrics.roe);
  const debtRatio = finite(metrics.debtRatio);
  const salesGrowth = finite(metrics.salesGrowth);
  const operatingGrowth = finite(metrics.operatingGrowth);
  const netIncomeGrowth = finite(metrics.netIncomeGrowth);
  let score = 50;
  if (per !== null) score += per > 0 && per <= 15 ? 6 : per > 30 || per <= 0 ? -5 : 1;
  if (pbr !== null) score += pbr > 0 && pbr <= 1.5 ? 5 : pbr > 5 || pbr <= 0 ? -4 : 1;
  if (roe !== null) score += roe >= 15 ? 10 : roe >= 8 ? 5 : roe < 0 ? -10 : -2;
  if (debtRatio !== null) score += debtRatio <= 100 ? 7 : debtRatio > 200 ? -8 : 0;
  for (const growth of [salesGrowth, operatingGrowth, netIncomeGrowth]) {
    if (growth !== null) score += growth >= 10 ? 4 : growth < 0 ? -4 : 1;
  }
  score = Math.max(20, Math.min(90, Math.round(score)));
  const opinion = score >= 80 ? "적극 관심" : score >= 65 ? "관심" : score >= 50 ? "중립" : score >= 35 ? "주의" : "적극 주의";
  const positives = [];
  const cautions = [];
  if (roe !== null) (roe >= 8 ? positives : cautions).push(`ROE ${roe.toFixed(1)}%로 자기자본 수익성을 확인할 수 있습니다.`);
  if (debtRatio !== null) (debtRatio <= 100 ? positives : cautions).push(`부채비율 ${debtRatio.toFixed(1)}%로 재무 부담 수준을 점검했습니다.`);
  for (const [label, growth] of [["매출 증가율", salesGrowth], ["영업이익 증가율", operatingGrowth], ["순이익 증가율", netIncomeGrowth]]) {
    if (growth !== null) (growth >= 0 ? positives : cautions).push(signedDescription(label, growth));
  }
  if (per !== null && per > 30) cautions.push(`PER ${per.toFixed(1)}배로 이익 대비 주가 부담을 함께 살펴야 합니다.`);
  if (!positives.length) positives.push("제공된 지표만으로 뚜렷한 긍정 신호를 확인하기 어렵습니다.");
  if (!cautions.length) cautions.push("업종 비교와 향후 실적 전망 데이터가 없어 결과에 불확실성이 있습니다.");
  const display = (value, suffix) => value === null ? "자료 없음" : `${value.toFixed(1)}${suffix}`;
  return {
    source: "fundamental-model",
    opinion,
    score,
    summary: `${name}의 ${period || "최신"} 재무지표를 종합하면 현재 관찰 의견은 ‘${opinion}’입니다. 단일 결산 지표를 이용한 학습용 분석이므로 미래 수익률을 뜻하지 않습니다.`,
    positives: positives.slice(0, 3),
    cautions: cautions.slice(0, 3),
    metricReads: [
      { label: "가치평가", interpretation: `PER ${display(per, "배")} · PBR ${display(pbr, "배")}` },
      { label: "수익성", interpretation: `ROE ${display(roe, "%")}` },
      { label: "성장성", interpretation: `매출 ${display(salesGrowth, "%")} · 영업이익 ${display(operatingGrowth, "%")}` },
      { label: "안정성", interpretation: `부채비율 ${display(debtRatio, "%")}` },
    ],
  };
}

export async function createAdvisorAnalysis(input) {
  const fallback = fallbackAnalysis(input);
  if (!process.env.OPENAI_API_KEY) return fallback;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
        store: false,
        instructions: "당신은 한국 장기자산관리 모의투자 분석가다. 제공된 현재 지수, 가격변화율, 체결강도 추정치만 사용한다. 확정적 수익을 약속하지 말고 기간별 전망과 위험을 한국어로 간결하게 작성한다.",
        input: JSON.stringify(input),
        text: { format: { type: "json_schema", name: "advisor_analysis", strict: true, schema } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const parsed = JSON.parse(extractText(await response.json()));
    return { ...parsed, source: "openai" };
  } catch (error) {
    return { ...fallback, source: "market-model", fallbackReason: error.message };
  }
}

export async function createFundamentalAnalysis(input) {
  const fallback = fallbackFundamentalAnalysis(input);
  if (!process.env.OPENAI_API_KEY) return fallback;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
        store: false,
        instructions: "당신은 한국 주식 모의투자 서비스의 재무 분석가다. 입력에 포함된 결산 지표만 근거로 사용하고 업종 평균, 뉴스, 전망치, 목표주가를 추정하거나 만들지 않는다. 의견은 적극 관심·관심·중립·주의·적극 주의 중 하나로 정하고 0~100 점수를 제시한다. 자료가 없으면 불확실성으로 명시한다. 확정적 수익, 매수·매도 지시, 목표주가를 제시하지 말고 쉽고 간결한 한국어로 설명한다.",
        input: JSON.stringify(input),
        text: { format: { type: "json_schema", name: "fundamental_analysis", strict: true, schema: fundamentalSchema } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const parsed = JSON.parse(extractText(await response.json()));
    return { ...parsed, score: Math.max(0, Math.min(100, Number(parsed.score) || 0)), source: "openai" };
  } catch (error) {
    return { ...fallback, fallbackReason: error.message };
  }
}
