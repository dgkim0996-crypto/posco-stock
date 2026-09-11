import React, { useEffect, useState } from "react";
import { apiFetch, apiUrl } from "../utils/api.js";

const value = (number, suffix = "", digits = 2) => Number.isFinite(number) ? `${number.toLocaleString(undefined, { maximumFractionDigits: digits })}${suffix}` : "자료 없음";

const METRIC_GUIDE = {
  PER: ["주가수익비율", "주가가 주당순이익의 몇 배인지 보여줘요.", "주가 ÷ 주당순이익(EPS)", "낮을수록 이익 대비 주가가 낮다고 볼 수 있지만, 적자 기업은 해석에 주의해야 해요."],
  PBR: ["주가순자산비율", "주가가 주당순자산의 몇 배인지 보여줘요.", "주가 ÷ 주당순자산(BPS)", "1배보다 낮으면 장부가치보다 주가가 낮다는 뜻이지만 자산의 질도 함께 봐야 해요."],
  ROE: ["자기자본이익률", "주주가 맡긴 자본으로 이익을 얼마나 냈는지 보여줘요.", "당기순이익 ÷ 자기자본 × 100", "높고 꾸준할수록 자본을 효율적으로 활용한다고 볼 수 있어요."],
  EPS: ["주당순이익", "보통주 한 주가 벌어들인 순이익이에요.", "당기순이익 ÷ 유통주식수", "증가 흐름은 긍정적이지만 일회성 이익이 포함됐는지 확인해야 해요."],
  BPS: ["주당순자산", "회사의 순자산을 한 주당 금액으로 나타낸 값이에요.", "자기자본 ÷ 발행주식수", "현재 주가와 비교하면 자산가치 대비 평가 수준을 볼 수 있어요."],
  시가총액: ["시가총액", "시장에서 평가하는 회사 전체의 주식 가치예요.", "현재 주가 × 상장주식수", "기업 규모를 비교할 때 쓰며 회사가 가진 현금과 같은 뜻은 아니에요."],
  부채비율: ["부채비율", "자기자본과 비교해 부채가 어느 정도인지 보여줘요.", "총부채 ÷ 자기자본 × 100", "낮을수록 일반적으로 안정적이지만 금융업처럼 업종에 따라 기준이 달라요."],
  "외국인 보유": ["외국인 보유율", "전체 상장주식 중 외국인이 보유한 비중이에요.", "외국인 보유주식수 ÷ 상장주식수 × 100", "수급 참고 지표이며 높고 낮음만으로 기업가치를 판단할 수 없어요."],
  "매출 증가율": ["매출 증가율", "이전 비교 기간보다 매출이 얼마나 늘거나 줄었는지 보여줘요.", "(현재 매출 ÷ 이전 매출 - 1) × 100", "본업의 외형 성장 흐름을 볼 수 있으며 기저효과에 주의해야 해요."],
  "영업이익 증가율": ["영업이익 증가율", "본업에서 번 이익의 증가·감소 폭이에요.", "(현재 영업이익 ÷ 이전 영업이익 - 1) × 100", "매출과 함께 늘면 수익 구조가 개선되는 신호일 수 있어요."],
  "순이익 증가율": ["순이익 증가율", "세금과 영업외손익까지 반영한 최종 이익의 변화율이에요.", "(현재 순이익 ÷ 이전 순이익 - 1) × 100", "일회성 처분이익·손실 때문에 크게 움직일 수 있어요."],
  "거래량 회전율": ["거래량 회전율", "상장주식수 대비 하루 거래량의 비율이에요.", "거래량 ÷ 상장주식수 × 100", "높으면 거래가 활발하다는 뜻이지만 기업의 수익성과는 별개예요."],
};

const OPINION_STEPS = ["적극 주의", "주의", "중립", "관심", "적극 관심"];

function MetricCard({ label, display }) {
  const [title, description, formula, reading] = METRIC_GUIDE[label];
  const tooltipId = `metric-guide-${label.replace(/\s/g, "-")}`;
  return <div className={display === "자료 없음" ? "is-empty" : ""}>
    <span className="metric-label">{label}<button type="button" className="metric-help" aria-label={`${label} 설명`} aria-describedby={tooltipId}>?</button></span>
    <strong>{display}</strong>
    <div className="metric-tooltip" id={tooltipId} role="tooltip"><b>{title}</b><p>{description}</p><small><em>계산</em>{formula}</small><small><em>해석</em>{reading}</small></div>
  </div>;
}

function FundamentalAdvisor({ asset, data }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setAnalysis(null); setError(""); }, [asset.symbol, data?.updatedAt]);

  const analyze = async () => {
    setLoading(true); setError("");
    try {
      const response = await apiFetch("/api/advisor/fundamentals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: asset.symbol, name: asset.name, period: data.period, source: data.source, metrics: data.metrics }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "LLM 분석을 불러오지 못했습니다.");
      setAnalysis(payload);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const opinionIndex = analysis ? OPINION_STEPS.indexOf(analysis.opinion) : -1;
  return <section className="fundamental-advisor" aria-live="polite">
    <div className="fundamental-advisor-head"><div><span>LLM FINANCIAL VIEW</span><strong>{asset.name} 재무 분석</strong><p>공시 기반 투자지표의 가치평가·수익성·성장성·안정성을 함께 읽어요.</p></div><button type="button" onClick={analyze} disabled={loading}>{loading ? "분석 중…" : analysis ? "다시 분석" : "LLM 추천 보기"}</button></div>
    {error && <div className="fundamental-advisor-error">{error}</div>}
    {analysis && <div className="fundamental-advisor-result">
      <div className="advisor-opinion"><div><small>{analysis.source === "openai" ? "LLM 종합 의견" : "재무모델 종합 의견"}</small><strong>{analysis.opinion}</strong><span>재무 점수 {Math.round(analysis.score)} / 100</span></div><div className="opinion-scale">{OPINION_STEPS.map((step, index) => <i key={step} className={index === opinionIndex ? "active" : ""}><b/>{step}</i>)}</div></div>
      <p className="advisor-summary">{analysis.summary}</p>
      <div className="advisor-metric-reads">{analysis.metricReads.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.interpretation}</strong></div>)}</div>
      <div className="advisor-evidence"><div><strong>긍정적으로 본 근거</strong>{analysis.positives.map((item) => <p key={item}>{item}</p>)}</div><div className="is-caution"><strong>꼭 확인할 위험</strong>{analysis.cautions.map((item) => <p key={item}>{item}</p>)}</div></div>
      <small className="advisor-disclaimer">이 결과는 제공된 재무지표만 분석한 학습용 의견이며 매수·매도 권유나 수익 보장이 아닙니다. 업종 비교, 최신 공시와 시장 상황을 함께 확인하세요.</small>
    </div>}
  </section>;
}

export default function StockFundamentals({ asset }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    fetch(apiUrl(`/api/fundamentals/${encodeURIComponent(asset.symbol)}`), { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("종목정보를 불러오지 못했습니다."); return response.json(); })
      .then(setData).catch((err) => { if (err.name !== "AbortError") setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [asset.symbol, reload]);

  const m = data?.metrics || {};
  const metrics = [
    ["PER", value(m.per, "배")], ["PBR", value(m.pbr, "배")], ["ROE", value(m.roe, "%")], ["EPS", value(m.eps, "원", 0)],
    ["BPS", value(m.bps, "원", 0)], ["시가총액", Number.isFinite(m.marketCap) ? `${m.marketCap.toLocaleString()}억원` : "자료 없음"],
    ["부채비율", value(m.debtRatio, "%")], ["외국인 보유", value(m.foreignOwnership, "%")],
    ["매출 증가율", value(m.salesGrowth, "%")], ["영업이익 증가율", value(m.operatingGrowth, "%")], ["순이익 증가율", value(m.netIncomeGrowth, "%")], ["거래량 회전율", value(m.volumeTurnover, "%")],
  ];

  return <section className="panel fundamentals-panel"><div className="fundamentals-head"><div><span>기업 · 재무</span><strong>종목정보와 투자지표</strong><em>{data?.period ? `${data.period} 결산 기준` : "최신 제공 기준"}</em></div><button type="button" onClick={() => setReload((count) => count + 1)}>새로고침</button></div>{loading ? <div className="fundamentals-state">실제 투자지표를 불러오고 있습니다…</div> : error ? <div className="fundamentals-state is-error">{error}<small>KIS API 연결 상태를 확인해 주세요.</small></div> : !data?.supported ? <div className="fundamentals-state">{data?.message || "제공되는 재무지표가 없습니다."}<small>임의 값은 표시하지 않습니다.</small></div> : <><div className="fundamentals-guide-note"><b>? 도움말</b>에 마우스를 올리거나 키보드로 선택하면 계산법과 해석을 볼 수 있어요.</div><div className="fundamentals-grid">{metrics.map(([label, display]) => <MetricCard key={label} label={label} display={display} />)}</div><div className="fundamentals-range"><span>250일 최저 <strong>{value(m.low250, "원", 0)}</strong></span><i/><span>250일 최고 <strong>{value(m.high250, "원", 0)}</strong></span></div><FundamentalAdvisor asset={asset} data={data}/><p>출처: {data.source} · 지표는 결산 시점과 제공 기준에 따라 현재 주가와 차이가 있을 수 있습니다.</p></>}</section>;
}
