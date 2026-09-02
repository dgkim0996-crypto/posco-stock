import React, { useState } from "react";

const PRODUCTS = [
  { key:"domestic", icon:"KR", title:"국내주식", desc:"코스피·코스닥 주요 종목을 모의 주문", tags:["실시간 모의시세","시장가 주문"], target:"stocks", seed:"005490" },
  { key:"global", icon:"US", title:"해외주식", desc:"미국 기술주를 원화 환산해 모의 거래", tags:["NASDAQ · NYSE","USD 환산"], target:"stocks", seed:"AAPL" },
  { key:"etf", icon:"ETF", title:"ETF · ETN", desc:"분산투자 상품을 한눈에 비교하는 상품관", tags:["테마형","지수형"], target:"stocks", seed:"069500" },
  { key:"bond", icon:"B", title:"채권", desc:"한국·미국 국채의 수익률과 듀레이션 확인", tags:["국채","수익률"], target:"bonds", seed:"KR3Y" },
  { key:"future", icon:"F", title:"선물 · 옵션", desc:"증거금 기반 LONG · SHORT 파생상품 거래", tags:["KOSPI200","해외선물"], target:"futures", seed:"K200" },
  { key:"pension", icon:"P", title:"연금 · ISA", desc:"장기 자산관리 상품 구조를 살펴보는 모의 메뉴", tags:["연금저축","ISA"], target:null },
];

export default function Products({ onGoTrading }) {
  const [selected,setSelected] = useState("all");
  const [compare,setCompare] = useState([]);
  const toggleCompare = (key) => setCompare((prev)=>prev.includes(key)?prev.filter((x)=>x!==key):prev.length<3?[...prev,key]:prev);

  return (
    <section className="service-page product-page">
      <div className="service-hero product-hero"><div><span className="service-kicker">PRODUCTS</span><h1>목적에 맞는 투자상품 찾기</h1><p>국내·해외주식부터 채권과 파생상품까지 상품별 특징을 비교하고 거래 화면으로 이동할 수 있습니다.</p></div><div className="risk-guide"><span>투자성향</span><strong>중립투자형</strong><em>모의 진단 결과</em></div></div>

      <div className="product-category-tabs">{[["all","전체"],["stock","주식"],["income","채권·안정형"],["derivative","파생"],["longterm","장기자산관리"]].map(([key,label])=><button key={key} className={selected===key?"active":""} onClick={()=>setSelected(key)}>{label}</button>)}</div>

      <div className="product-grid">
        {PRODUCTS.filter((p)=>selected==="all" || (selected==="stock"&&["domestic","global","etf"].includes(p.key)) || (selected==="income"&&p.key==="bond") || (selected==="derivative"&&p.key==="future") || (selected==="longterm"&&p.key==="pension")).map((product)=><article className="product-card" key={product.key}><div className="product-icon">{product.icon}</div><span className="product-eyebrow">투자상품</span><h2>{product.title}</h2><p>{product.desc}</p><div className="product-tags">{product.tags.map((tag)=><span key={tag}>{tag}</span>)}</div><div className="product-card-actions"><button type="button" className="outline-action" onClick={()=>toggleCompare(product.key)}>{compare.includes(product.key)?"비교 해제":"비교 담기"}</button>{product.target?<button type="button" className="primary-action" onClick={()=>onGoTrading(product.target, product.seed)}>거래하기</button>:<button type="button" className="disabled-action">상품 안내</button>}</div></article>)}
      </div>

      {compare.length > 0 && <div className="compare-tray"><span><strong>{compare.length}개 상품</strong> 비교 목록에 담았습니다.</span><div>{compare.map((key)=><b key={key}>{PRODUCTS.find((p)=>p.key===key)?.title}</b>)}</div><button onClick={()=>setCompare([])}>비우기</button></div>}

      <div className="service-two-col product-info-row">
        <article className="service-card"><div className="service-card-head"><div><span>투자 가이드</span><strong>상품 선택 전에 확인하세요</strong></div></div><div className="guide-list"><div><b>1</b><span><strong>투자목적 설정</strong><em>수익 추구, 현금흐름, 장기자산관리 목적을 먼저 정합니다.</em></span></div><div><b>2</b><span><strong>위험도 확인</strong><em>원금손실 가능성과 가격 변동성을 상품별로 비교합니다.</em></span></div><div><b>3</b><span><strong>비용 확인</strong><em>수수료, 환전비용, 세금과 기타 제비용을 확인합니다.</em></span></div></div></article>
        <article className="service-card"><div className="service-card-head"><div><span>상품 공시</span><strong>설명서 · 위험등급 · 유의사항</strong></div></div><div className="document-links"><button>핵심상품설명서 <span>→</span></button><button>투자위험등급 안내 <span>→</span></button><button>수수료 안내 <span>→</span></button><button>금융소비자 유의사항 <span>→</span></button></div></article>
      </div>
    </section>
  );
}
