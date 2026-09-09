import React, { useMemo, useState } from "react";
import AssetLogo from "./AssetLogo.jsx";

const GUIDES = {
  pension: { title: "연금저축", subtitle: "세액공제와 장기 분산투자를 함께", facts: [["연간 납입", "연금계좌 합산 1,800만원"], ["세액공제", "연금저축 600만원 한도"], ["수령", "만 55세 이후 연금수령"], ["운용", "펀드·ETF 중심 직접 운용"]], mix: "주식형 50% · 채권형 35% · 현금성 15%" },
  isa: { title: "중개형 ISA", subtitle: "한 계좌에서 손익통산과 절세", facts: [["연간 납입", "2,000만원·미사용 한도 이월"], ["의무기간", "3년"], ["비과세", "일반형 200만원·서민형 400만원"], ["초과수익", "9.9% 분리과세"]], mix: "국내 ETF 55% · 채권 30% · 현금성 15%" },
  retirement: { title: "개인형 IRP", subtitle: "퇴직자금과 추가납입을 한 계좌로", facts: [["세액공제", "연금계좌 합산 900만원"], ["공제율", "소득에 따라 12% 또는 15%"], ["위험자산", "통상 적립금의 70% 이내"], ["수령", "연금수령 시 과세이연 효과"]], mix: "TDF·주식형 60% · 예금·채권 40%" },
  wrap: { title: "자산관리 랩", subtitle: "투자성향에 맞춘 일임형 포트폴리오", facts: [["운용", "전문가·모델 포트폴리오"], ["관리", "시장 변화에 따른 리밸런싱"], ["비용", "일임수수료·상품보수 확인"], ["유의", "예금자보호 대상 아님"]], mix: "AI 제안 비중을 기반으로 분산 운용" },
};

function ProjectionChart() {
  const [monthly, setMonthly] = useState(500000);
  const [years, setYears] = useState(20);
  const points = useMemo(() => {
    let deposit = 0; let irp = 0;
    return Array.from({ length: years + 1 }, (_, year) => {
      if (year > 0) {
        for (let month = 0; month < 12; month += 1) { deposit = (deposit + monthly) * (1 + 0.03 / 12); irp = (irp + monthly) * (1 + 0.06 / 12); }
        irp += Math.min(monthly * 12, 9000000) * 0.132;
      }
      return { year, deposit, irp };
    });
  }, [monthly, years]);
  const max = Math.max(points.at(-1).irp, 1);
  const path = (key) => points.map((point, index) => `${index ? "L" : "M"}${(index / years) * 680},${210 - (point[key] / max) * 190}`).join(" ");
  const end = points.at(-1);
  return <div className="projection-card"><div className="projection-head"><div><span>IRP 절세·복리 시뮬레이션</span><strong>예금과 장기 종합수익 비교</strong></div><div><label>월 납입 <input type="number" step="100000" min="100000" value={monthly} onChange={(e) => setMonthly(Math.max(100000, Number(e.target.value)))} /></label><label>기간 <select value={years} onChange={(e) => setYears(Number(e.target.value))}><option value="10">10년</option><option value="20">20년</option><option value="30">30년</option></select></label></div></div><svg className="projection-chart" viewBox="0 0 680 230" role="img" aria-label="예금과 IRP 예상자산 비교 그래프"><line x1="0" y1="210" x2="680" y2="210" className="projection-axis"/><path d={path("deposit")} className="projection-line deposit-line" pathLength="1"/><path d={path("irp")} className="projection-line irp-line" pathLength="1"/></svg><div className="projection-legend"><span><i className="deposit-dot"/>예금 연 3% <strong>{Math.round(end.deposit).toLocaleString()}원</strong></span><span><i className="irp-dot"/>IRP 연 6% + 세액공제 재투자 <strong>{Math.round(end.irp).toLocaleString()}원</strong></span><b>차이 {Math.round(end.irp - end.deposit).toLocaleString()}원</b></div><p>세액공제율 13.2%를 단순 가정한 모의 계산이며 실제 수익률·공제액·세금은 소득과 상품에 따라 달라집니다.</p></div>;
}

export default function LongTermGuide({ type, stocks, indices, onClose, onGoTrading }) {
  const guide = GUIDES[type];
  const [profile, setProfile] = useState("balanced");
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function analyze() {
    setLoading(true); setError("");
    try {
      const candidates = stocks.slice(0, 40).map((item) => ({ symbol: item.symbol, name: item.name, market: item.market, group: item.group, price: item.price, change: item.change, volume: item.volume || 0, strength: Math.round(100 + Math.max(-30, Math.min(30, item.change * 8))) }));
      const response = await fetch("/api/advisor/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: type, profile, indices, candidates }) });
      if (!response.ok) throw new Error("분석 서버 응답 오류");
      setAnalysis(await response.json());
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return <section className="longterm-guide"><button type="button" className="guide-back" onClick={onClose}>← 상품 목록</button><div className="longterm-hero"><div><span>LONG-TERM WEALTH</span><h1>{guide.title}</h1><p>{guide.subtitle}</p></div><b>{guide.mix}</b></div><div className="longterm-facts">{guide.facts.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{type === "retirement" && <ProjectionChart/>}<div className="advisor-panel"><div className="advisor-title"><div><span>AI MARKET ADVISOR</span><h2>시장·체결강도 기반 장기투자 제안</h2><p>현재 지수와 종목 등락, 체결강도 추정치를 종합해 단·중·장기 전망과 후보를 분석합니다.</p></div><div className="advisor-controls"><select value={profile} onChange={(e) => setProfile(e.target.value)}><option value="conservative">안정형</option><option value="balanced">중립형</option><option value="growth">성장형</option></select><button type="button" onClick={analyze} disabled={loading}>{loading ? "분석 중…" : "AI 분석 시작"}</button></div></div>{error && <div className="advisor-error">{error}</div>}{analysis && <><div className="market-outlook"><strong>{analysis.source === "openai" ? "LLM 분석" : "시장모델 분석"}</strong><p>{analysis.marketSummary}</p><div><span><b>단기</b>{analysis.horizons.short}</span><span><b>중기</b>{analysis.horizons.medium}</span><span><b>장기</b>{analysis.horizons.long}</span></div></div><div className="advisor-recommendations">{analysis.recommendations.map((item) => { const asset = stocks.find((stock) => stock.symbol === item.symbol) || item; return <article key={item.symbol}><AssetLogo asset={asset} size="md"/><div><span>{item.horizon} · 점수 {Math.round(item.score)}</span><h3>{item.name}</h3><p>{item.reason}</p><small>{item.risk}</small></div><b>{item.weight}%</b><button type="button" onClick={() => onGoTrading("stocks", item.symbol)}>모의 투자</button></article>; })}</div></>}</div><div className="longterm-notice">세제 혜택은 개인별 소득·가입요건과 법령 변경에 따라 달라질 수 있습니다. 본 화면은 모의 안내이며 가입 전 최신 상품설명서와 세법을 확인해야 합니다.</div></section>;
}
