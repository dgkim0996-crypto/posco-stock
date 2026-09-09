import React, { useMemo, useState } from "react";
import AssetLogo from "../components/AssetLogo.jsx";

const MARKET_META = {
  KOSPI: { label: "KOSPI", count: "934종목" },
  KOSDAQ: { label: "KOSDAQ", count: "1,742종목" },
  NASDAQ: { label: "NASDAQ", count: "3,285종목" },
};

// 시가총액 단위는 국내 시장은 조원, 미국 시장은 십억 달러다.
const EXTRA_ASSETS = {
  KOSPI: [
    ["005380","현대차",2.18,"자동차",57],["000270","기아",1.42,"자동차",42],["068270","셀트리온",-1.26,"헬스케어",38],
    ["105560","KB금융",2.87,"금융",35],["055550","신한지주",1.73,"금융",28],["012450","한화에어로스페이스",3.46,"산업재",32],
    ["373220","LG에너지솔루션",-0.74,"2차전지",87],["207940","삼성바이오로직스",0.35,"헬스케어",76],["006400","삼성SDI",-1.64,"2차전지",22],
    ["028260","삼성물산",0.92,"산업재",25],["066570","LG전자",1.05,"IT",16],["051910","LG화학",-2.11,"소재",24],
  ],
  KOSDAQ: [
    ["247540","에코프로비엠",-2.42,"2차전지",13.5],["086520","에코프로",-1.83,"2차전지",8.4],["196170","알테오젠",3.72,"바이오",22],
    ["028300","HLB",1.26,"바이오",9.5],["277810","레인보우로보틱스",4.18,"로봇",6.8],["263750","펄어비스",-0.84,"게임",2.4],
    ["035900","JYP Ent.",2.04,"엔터",2.8],["041510","에스엠",1.17,"엔터",2.5],["293490","카카오게임즈",-1.12,"게임",1.5],
    ["214150","클래시스",0.66,"헬스케어",4.9],["145020","휴젤",-0.38,"헬스케어",3.7],["357780","솔브레인",1.49,"반도체",2.1],
    ["403870","HPSP",2.81,"반도체",3.3],["058470","리노공업",0.94,"반도체",5.1],["039030","이오테크닉스",-1.57,"반도체",2.7],
  ],
  NASDAQ: [
    ["COST","Costco",0.58,"소비재",430],["PEP","PepsiCo",-0.22,"소비재",210],["TMUS","T-Mobile",0.73,"통신",275],
    ["ISRG","Intuitive Surgical",1.34,"헬스케어",190],["BKNG","Booking",-0.47,"여행",170],["SBUX","Starbucks",0.29,"소비재",105],
  ],
};

const MARKET_CAPS = {
  "005930":390,"000660":160,"005490":25,"003670":16,"047050":9,"022100":4.5,"058430":0.65,"009520":0.75,
  "035420":34,"035720":24,"069500":8.5,"133690":4.2,"305720":1.4,
  QQQ:360,AAPL:3400,MSFT:3100,NVDA:4200,GOOGL:2500,AMZN:2400,META:1900,TSLA:1400,AVGO:1500,NFLX:520,
  PLTR:430,AMD:310,INTC:105,QCOM:190,MU:150,TXN:180,ARM:145,ASML:390,AMAT:150,LRCX:145,KLAC:135,MRVL:95,
  ADI:125,MCHP:65,NXPI:55,ON:23,ADBE:135,DDOG:55,MDB:25,CRWD:115,PANW:125,FTNT:70,ZS:45,OKTA:16,
  TEAM:42,WDAY:58,INTU:190,ADSK:65,CSCO:300,SMCI:28,SHOP:210,ABNB:88,
};

function extraAssets(market) {
  return (EXTRA_ASSETS[market] || []).map(([symbol, name, change, sector, marketCap]) => ({ id: symbol, symbol, name, change, sector, market, marketCap }));
}

// 각 타일의 면적이 전체 시가총액에서 차지하는 비율과 같도록 큰 사각형을 재귀 분할한다.
function buildTreemap(items, rect = { x: 0, y: 0, width: 100, height: 100 }) {
  if (!items.length) return [];
  if (items.length === 1) return [{ ...items[0], rect }];
  const total = items.reduce((sum, item) => sum + item.marketCap, 0);
  let split = 1;
  let running = items[0].marketCap;
  while (split < items.length - 1 && running + items[split].marketCap <= total / 2) {
    running += items[split].marketCap;
    split += 1;
  }
  const first = items.slice(0, split);
  const second = items.slice(split);
  const ratio = first.reduce((sum, item) => sum + item.marketCap, 0) / total;
  if (rect.width >= rect.height) {
    const firstWidth = rect.width * ratio;
    return [...buildTreemap(first, { ...rect, width: firstWidth }), ...buildTreemap(second, { x: rect.x + firstWidth, y: rect.y, width: rect.width - firstWidth, height: rect.height })];
  }
  const firstHeight = rect.height * ratio;
  return [...buildTreemap(first, { ...rect, height: firstHeight }), ...buildTreemap(second, { x: rect.x, y: rect.y + firstHeight, width: rect.width, height: rect.height - firstHeight })];
}

function heatColor(change) {
  const strength = Math.min(Math.abs(change), 4);
  if (Math.abs(change) < 0.15) return "#68717a";
  if (change > 0) return strength > 2.5 ? "#04783f" : strength > 1.2 ? "#079653" : "#39ad75";
  return strength > 2.5 ? "#c93843" : strength > 1.2 ? "#df4f58" : "#e9787e";
}

function signed(value) { return `${value >= 0 ? "+" : ""}${Number(value).toFixed(2)}%`; }
function capLabel(asset, market) { return market === "NASDAQ" ? `$${asset.marketCap.toLocaleString()}B` : `${asset.marketCap.toLocaleString()}조`; }

export default function MarketSummary({ stocks, indices, onOpenAsset }) {
  const [market, setMarket] = useState("KOSPI");
  const [showNames, setShowNames] = useState(true);
  const assets = useMemo(() => {
    const live = stocks.filter((asset) => asset.market === market).map((asset, index) => ({
      ...asset, marketCap: MARKET_CAPS[asset.id] || 1,
      sector: asset.group === "POSCO" ? "POSCO그룹" : index < 4 ? "테크" : "ETF",
    }));
    const merged = [...live, ...extraAssets(market)];
    return merged.filter((asset, index) => merged.findIndex((item) => item.id === asset.id) === index).sort((a, b) => b.marketCap - a.marketCap).slice(0, 20);
  }, [stocks, market]);
  const tiles = useMemo(() => buildTreemap(assets), [assets]);
  const advancers = assets.filter((asset) => asset.change > 0).length;
  const average = assets.reduce((sum, asset) => sum + asset.change, 0) / Math.max(assets.length, 1);
  const liveIndex = indices.find((item) => item.name === market);
  const meta = liveIndex ? { ...MARKET_META[market], value: liveIndex.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), change: liveIndex.change } : { ...MARKET_META[market], value: "불러오는 중", change: null };

  return (
    <main className="heatmap-page">
      <section className="heatmap-heading">
        <div><span className="heatmap-kicker">MARKET OVERVIEW</span><h1>시장 요약</h1><p>시장별 주요 종목의 흐름과 강도를 한눈에 살펴보세요.</p></div>
        <div className="market-clock"><i /> 실시간 모의시세 <b>장중</b></div>
      </section>
      <section className="market-index-row" aria-label="주요 시장 지수">
        {Object.entries(MARKET_META).map(([key, item]) => {
          const live = indices.find((index) => index.name === key);
          const shown = live ? { ...item, value: live.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), change: live.change } : { ...item, value: "불러오는 중", change: null };
          return <button key={key} type="button" className={market === key ? "active" : ""} onClick={() => setMarket(key)}><span>{shown.label}<em>{shown.count}</em></span><strong>{shown.value}</strong><b className={shown.change === null ? "index-pending" : shown.change >= 0 ? "heat-up" : "heat-down"}>{shown.change === null ? "실제 지수 연결 중" : signed(shown.change)}</b></button>;
        })}
      </section>
      <section className="heatmap-panel">
        <div className="heatmap-toolbar">
          <div className="heatmap-market-tabs" role="tablist">{Object.keys(MARKET_META).map((key) => <button key={key} type="button" role="tab" aria-selected={market === key} className={market === key ? "active" : ""} onClick={() => setMarket(key)}>{key}</button>)}</div>
          <div className="heatmap-controls"><span>크기 <b>시가총액</b></span><span>색상 <b>등락률</b></span><button type="button" className={showNames ? "active" : ""} onClick={() => setShowNames((value) => !value)}>종목명</button></div>
        </div>
        <div className="heatmap-subhead">
          <div><strong>{meta.label} 히트맵</strong><span>시가총액 비중 · 업종 혼합</span></div>
          <div><span className="legend-loss">-4%</span><i className="heat-gradient" /><span className="legend-gain">+4%</span></div>
        </div>
        <div className="stock-treemap" role="list" aria-label={`${market} 종목 히트맵`}>
          {tiles.map((asset, index) => <button key={asset.id} type="button" role="listitem" className={`heat-tile heat-tile-${index}`} style={{ left: `${asset.rect.x}%`, top: `${asset.rect.y}%`, width: `${asset.rect.width}%`, height: `${asset.rect.height}%`, background: heatColor(asset.change) }} onClick={() => stocks.some((stock) => stock.id === asset.id) && onOpenAsset(asset.id)} title={`${asset.name} (${asset.symbol}) · 시가총액 ${capLabel(asset, market)} · ${signed(asset.change)}`}>
              {index < 8 && <AssetLogo asset={asset} size={index < 3 ? "md" : "xs"} className="heat-logo" />}
              <strong className="heat-name">{showNames ? asset.name : asset.symbol}</strong>
              <span className="heat-code">{asset.symbol}</span><b>{signed(asset.change)}</b>
              {index < 8 && <em>{capLabel(asset, market)}</em>}
          </button>)}
        </div>
        <div className="heatmap-footer-stats">
          <div><span>상승 종목</span><strong className="heat-up">{advancers}</strong></div><div><span>하락 종목</span><strong className="heat-down">{assets.length - advancers}</strong></div><div><span>주요 종목 평균</span><strong className={average >= 0 ? "heat-up" : "heat-down"}>{signed(average)}</strong></div><p>타일 면적은 표시 종목 내 시가총액 비중, 색상은 당일 등락률을 나타냅니다.</p>
        </div>
      </section>
    </main>
  );
}
