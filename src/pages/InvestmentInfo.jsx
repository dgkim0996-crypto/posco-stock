import React, { useMemo, useState } from "react";

function pct(value){ return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }

const RESEARCH = [
  { tag:"산업", title:"AI 인프라 투자 확대와 반도체 밸류체인", analyst:"리서치센터", date:"08.31", level:"중립" },
  { tag:"기업", title:"철강·2차전지 소재 업종 체크포인트", analyst:"기업분석팀", date:"08.31", level:"관심" },
  { tag:"글로벌", title:"미국 기술주 변동성 대응 전략", analyst:"글로벌전략팀", date:"08.30", level:"참고" },
  { tag:"채권", title:"금리 변화에 따른 듀레이션 점검", analyst:"채권전략팀", date:"08.30", level:"중립" },
];

export default function InvestmentInfo({ markets, onOpenAsset }) {
  const [filter,setFilter] = useState("전체");
  const stocks = markets.stocks;
  const movers = useMemo(() => [...stocks].sort((a,b)=>Math.abs(b.change)-Math.abs(a.change)).slice(0,8), [stocks]);
  const rising = useMemo(() => [...stocks].sort((a,b)=>b.change-a.change).slice(0,5),[stocks]);
  const falling = useMemo(() => [...stocks].sort((a,b)=>a.change-b.change).slice(0,5),[stocks]);
  const posco = stocks.filter((item)=>item.group === "POSCO");
  const global = stocks.filter((item)=>item.unit === "USD");
  const shown = filter === "포스코" ? posco : filter === "해외기술" ? global.slice(0,12) : movers;

  return (
    <section className="service-page info-page">
      <div className="service-hero">
        <div><span className="service-kicker">INVESTMENT INFO</span><h1>시장 흐름을 빠르게 파악하세요</h1><p>모의 시세를 기반으로 시장 요약, 등락 종목, 리서치와 주요 일정을 구성했습니다.</p></div>
        <div className="hero-live"><span className="status-dot"/><strong>모의시장 LIVE</strong><em>1.5초 갱신</em></div>
      </div>

      <div className="index-grid">
        {[{name:"KOSPI",value:"2,684.21",change:0.64},{name:"KOSDAQ",value:"812.57",change:-0.31},{name:"NASDAQ",value:"21,455.30",change:0.82},{name:"S&P 500",value:"6,481.40",change:0.37},{name:"USD/KRW",value:"1,380.00",change:-0.12}].map((item)=><article key={item.name}><span>{item.name}</span><strong>{item.value}</strong><em className={item.change>=0?"up":"down"}>{pct(item.change)}</em><i className={item.change>=0?"mini-trend up-bg":"mini-trend down-bg"}/></article>)}
      </div>

      <div className="service-three-col info-main-grid">
        <article className="service-card span-2">
          <div className="service-card-head"><div><span>실시간 순위</span><strong>지금 움직이는 종목</strong></div><div className="inline-filter">{["전체","포스코","해외기술"].map((item)=><button key={item} className={filter===item?"active":""} onClick={()=>setFilter(item)}>{item}</button>)}</div></div>
          <div className="mover-list">{shown.map((asset,index)=><button type="button" key={asset.id} onClick={()=>onOpenAsset(asset.id)}><b>{index+1}</b><span><strong>{asset.name}</strong><em>{asset.symbol} · {asset.market || "MARKET"}</em></span><span className="mover-price"><strong>{asset.unit === "USD" ? `$${asset.price.toLocaleString(undefined,{maximumFractionDigits:2})}` : `${Math.round(asset.price).toLocaleString()}원`}</strong><em className={asset.change>=0?"up":"down"}>{pct(asset.change)}</em></span></button>)}</div>
        </article>

        <article className="service-card">
          <div className="service-card-head"><div><span>시장 온도</span><strong>상승 · 하락 TOP</strong></div></div>
          <div className="market-temperature"><div className="temperature-count"><span><b className="up">{rising.length}</b> 상승</span><span><b className="down">{falling.length}</b> 하락</span></div><div className="temperature-bar"><i style={{width:"55%"}}/></div></div>
          <div className="rank-mini"><strong>상승 상위</strong>{rising.slice(0,3).map((a)=><button key={a.id} onClick={()=>onOpenAsset(a.id)}><span>{a.name}</span><em className="up">{pct(a.change)}</em></button>)}<strong>하락 상위</strong>{falling.slice(0,3).map((a)=><button key={a.id} onClick={()=>onOpenAsset(a.id)}><span>{a.name}</span><em className="down">{pct(a.change)}</em></button>)}</div>
        </article>
      </div>

      <div className="service-two-col">
        <article className="service-card">
          <div className="service-card-head"><div><span>리서치</span><strong>오늘의 투자 인사이트</strong></div><button className="text-action">전체 리포트 →</button></div>
          <div className="research-list">{RESEARCH.map((item)=><button key={item.title}><span className="research-tag">{item.tag}</span><span><strong>{item.title}</strong><em>{item.analyst} · {item.date}</em></span><b>{item.level}</b></button>)}</div>
        </article>
        <article className="service-card">
          <div className="service-card-head"><div><span>주요 일정</span><strong>이번 주 시장 캘린더</strong></div><em>모의 콘텐츠</em></div>
          <div className="calendar-list"><div><time>08.31</time><span><strong>월말 포트폴리오 점검</strong><em>국내 · 계좌</em></span></div><div><time>09.01</time><span><strong>미국 제조업 지표 발표</strong><em>해외 · 경제지표</em></span></div><div><time>09.02</time><span><strong>반도체 산업 컨퍼런스</strong><em>글로벌 · 산업</em></span></div><div><time>09.04</time><span><strong>미국 고용 관련 지표</strong><em>해외 · 경제지표</em></span></div></div>
        </article>
      </div>

      <div className="info-disclaimer">투자정보 화면의 지수·리서치·일정은 UI 시연을 위한 모의 콘텐츠이며 실제 투자판단 자료가 아닙니다.</div>
    </section>
  );
}
