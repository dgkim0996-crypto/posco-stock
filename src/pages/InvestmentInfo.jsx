import React, { useEffect, useMemo, useState } from "react";

// 시세 상태로 등락 순위를 만들고, 서버에서 받은 실제 뉴스·기업 일정을 함께 보여준다.
function pct(value){ return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
const formatFeedDate = (value, includeTime = false) => {
  if (!value) return "날짜 미정";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(5).replace("-", ".");
  return new Intl.DateTimeFormat("ko-KR", includeTime ? { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" } : { month:"2-digit", day:"2-digit" }).format(date);
};
const ExternalLinkIcon = () => <span className="external-link-icon" aria-hidden="true">↗</span>;

export default function InvestmentInfo({ markets, indices, onOpenAsset }) {
  const [filter,setFilter] = useState("전체");
  const [temperatureMarket,setTemperatureMarket] = useState("전체");
  const [feed,setFeed] = useState({ articles:[], schedules:[], updatedAt:null });
  const [feedState,setFeedState] = useState("loading");
  const stocks = markets.stocks;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/feed", { signal:controller.signal }).then((response) => {
      if (!response.ok) throw new Error("피드 요청 실패");
      return response.json();
    }).then((payload) => {
      setFeed(payload);
      setFeedState(payload.articles?.length || payload.schedules?.length ? "ready" : "empty");
    }).catch((error) => { if (error.name !== "AbortError") setFeedState("error"); });
    return () => controller.abort();
  }, []);

  // 원본 배열을 변경하지 않도록 복사한 뒤 변동폭·상승·하락 기준 목록을 계산한다.
  const domestic = useMemo(() => stocks.filter((item)=>item.unit === "KRW"),[stocks]);
  const global = useMemo(() => stocks.filter((item)=>item.unit === "USD"),[stocks]);
  const posco = useMemo(() => stocks.filter((item)=>item.group === "POSCO"),[stocks]);
  const rankUniverse = filter === "국내증시" ? domestic : filter === "해외증시" ? global : filter === "포스코" ? posco : stocks;
  const shown = useMemo(() => [...rankUniverse].sort((a,b)=>Math.abs(b.change)-Math.abs(a.change)).slice(0,8),[rankUniverse]);
  const temperatureUniverse = temperatureMarket === "국내증시" ? domestic : temperatureMarket === "해외증시" ? global : stocks;
  const rising = useMemo(() => temperatureUniverse.filter((item)=>item.change >= 0).sort((a,b)=>b.change-a.change),[temperatureUniverse]);
  const falling = useMemo(() => temperatureUniverse.filter((item)=>item.change < 0).sort((a,b)=>a.change-b.change),[temperatureUniverse]);
  const risingRatio = temperatureUniverse.length ? (rising.length / temperatureUniverse.length) * 100 : 50;
  const feedMessage = feedState === "loading" ? "실제 데이터를 불러오는 중입니다." : feedState === "error" ? "외부 피드에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." : "현재 표시할 실제 데이터가 없습니다.";

  return (
    <section className="service-page info-page">
      <div className="service-hero">
        <div><span className="service-kicker">INVESTMENT INFO</span><h1>시장 흐름을 빠르게 파악하세요</h1><p>시장 요약과 함께 공개 뉴스 피드의 실제 기사, Nasdaq의 예정된 기업 실적 발표 일정을 제공합니다.</p></div>
        <div className="hero-live"><span className="status-dot"/><strong>MARKET FEED</strong><em>{feed.updatedAt ? `${formatFeedDate(feed.updatedAt, true)} 갱신` : "불러오는 중"}</em></div>
      </div>

      <div className="index-grid">
        {indices.map((item)=><article key={item.name}><span>{item.name}</span><strong>{item.value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</strong><em className={item.change>=0?"up":"down"}>{pct(item.change)}</em><i className={item.change>=0?"mini-trend up-bg":"mini-trend down-bg"}/></article>)}
        {!indices.length && <article className="index-loading"><span>실제 시장 지수</span><strong>불러오는 중</strong><em>잠시만 기다려 주세요</em></article>}
      </div>

      <div className="service-two-col primary-feed-grid">
        <article className="service-card">
          <div className="service-card-head"><div><span>실제 뉴스</span><strong>오늘의 시장 기사</strong></div><a className="text-action" href="https://news.google.com/" target="_blank" rel="noreferrer">전체 뉴스 <ExternalLinkIcon /></a></div>
          <div className="research-list">{feed.articles.length ? feed.articles.slice(0,6).map((item)=><a key={`${item.url}-${item.title}`} href={item.url} target="_blank" rel="noreferrer"><span className="research-tag">{item.category}</span><span><strong>{item.title}</strong><em>{item.source} · {formatFeedDate(item.publishedAt, true)}</em></span><ExternalLinkIcon /></a>) : <div className="feed-status">{feedMessage}</div>}</div>
        </article>
        <article className="service-card">
          <div className="service-card-head"><div><span>실제 일정</span><strong>예정된 주요 실적 발표</strong></div><a className="text-action" href="https://www.nasdaq.com/market-activity/earnings" target="_blank" rel="noreferrer">전체 일정 <ExternalLinkIcon /></a></div>
          <div className="calendar-list">{feed.schedules.length ? feed.schedules.slice(0,6).map((item)=><a key={`${item.date}-${item.title}`} href={item.url} target="_blank" rel="noreferrer"><time>{formatFeedDate(item.date)}</time><span><strong>{item.title}</strong><em>{item.description} · {item.source}</em></span><ExternalLinkIcon /></a>) : <div className="feed-status">{feedMessage}</div>}</div>
        </article>
      </div>

      <div className="service-three-col info-main-grid">
        <article className="service-card span-2">
          <div className="service-card-head"><div><span>실시간 순위</span><strong>지금 움직이는 종목</strong></div><div className="inline-filter market-scope-filter">{["전체","국내증시","해외증시","포스코"].map((item)=><button key={item} className={filter===item?"active":""} onClick={()=>setFilter(item)}>{item}</button>)}</div></div>
          <div className="mover-list">{shown.map((asset,index)=><button type="button" key={asset.id} onClick={()=>onOpenAsset(asset.id)}><b>{index+1}</b><span><strong>{asset.name}</strong><em>{asset.symbol} · {asset.market || "MARKET"}</em></span><span className="mover-price"><strong>{asset.unit === "USD" ? `$${asset.price.toLocaleString(undefined,{maximumFractionDigits:2})}` : `${Math.round(asset.price).toLocaleString()}원`}</strong><em className={asset.change>=0?"up":"down"}>{pct(asset.change)}</em></span></button>)}</div>
        </article>
        <article className="service-card">
          <div className="service-card-head"><div><span>시장 온도</span><strong>상승 · 하락 TOP</strong></div><div className="inline-filter market-scope-filter">{["전체","국내증시","해외증시"].map((item)=><button key={item} className={temperatureMarket===item?"active":""} onClick={()=>setTemperatureMarket(item)}>{item}</button>)}</div></div>
          <div className="market-temperature"><div className="temperature-count"><span><b className="up">{rising.length}</b> 상승</span><span><b className="down">{falling.length}</b> 하락</span></div><div className="temperature-bar"><i style={{width:`${risingRatio}%`}}/></div></div>
          <div className="rank-mini"><strong>상승 상위</strong>{rising.slice(0,3).map((a)=><button key={a.id} onClick={()=>onOpenAsset(a.id)}><span>{a.name}</span><em className="up">{pct(a.change)}</em></button>)}<strong>하락 상위</strong>{falling.slice(0,3).map((a)=><button key={a.id} onClick={()=>onOpenAsset(a.id)}><span>{a.name}</span><em className="down">{pct(a.change)}</em></button>)}</div>
        </article>
      </div>

      <div className="info-disclaimer">기사와 일정은 외부 공개 소스에서 제공되며 지연·변경될 수 있습니다. 항목을 누르면 원문 사이트가 새 창에서 열립니다. 투자 판단 전 원문과 공식 공시를 확인하세요.</div>
    </section>
  );
}
