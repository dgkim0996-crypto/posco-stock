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
