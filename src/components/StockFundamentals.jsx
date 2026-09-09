import React, { useEffect, useState } from "react";

const value = (number, suffix = "", digits = 2) => Number.isFinite(number) ? `${number.toLocaleString(undefined, { maximumFractionDigits: digits })}${suffix}` : "자료 없음";

export default function StockFundamentals({ asset }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    fetch(`/api/fundamentals/${encodeURIComponent(asset.symbol)}`, { signal: controller.signal })
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

  return <section className="panel fundamentals-panel"><div className="fundamentals-head"><div><span>기업 · 재무</span><strong>종목정보와 투자지표</strong><em>{data?.period ? `${data.period} 결산 기준` : "최신 제공 기준"}</em></div><button type="button" onClick={() => setReload((count) => count + 1)}>새로고침</button></div>{loading ? <div className="fundamentals-state">실제 투자지표를 불러오고 있습니다…</div> : error ? <div className="fundamentals-state is-error">{error}<small>KIS API 연결 상태를 확인해 주세요.</small></div> : !data?.supported ? <div className="fundamentals-state">{data?.message || "제공되는 재무지표가 없습니다."}<small>임의 값은 표시하지 않습니다.</small></div> : <><div className="fundamentals-grid">{metrics.map(([label, display]) => <div key={label} className={display === "자료 없음" ? "is-empty" : ""}><span>{label}</span><strong>{display}</strong></div>)}</div><div className="fundamentals-range"><span>250일 최저 <strong>{value(m.low250, "원", 0)}</strong></span><i/><span>250일 최고 <strong>{value(m.high250, "원", 0)}</strong></span></div><p>출처: {data.source} · 지표는 결산 시점과 제공 기준에 따라 현재 주가와 차이가 있을 수 있습니다.</p></>}</section>;
}
