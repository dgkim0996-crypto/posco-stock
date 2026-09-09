import React, { useEffect, useState } from "react";

// 상품 로고를 표시하고 외부 이미지 실패 시 종목 이니셜 배지로 대체하는 컴포넌트다.

const POSCO_GROUP_DOMAIN = "poscofuturem.com";

const TOSS_SECURITY_LOGOS = {
  "005930":"https://static.toss.im/png-icons/securities/icn-sec-fill-005930.png",
  "009150":"https://static.toss.im/png-icons/securities/icn-sec-fill-009150.png",
  "005935":"https://static.toss.im/png-icons/securities/icn-sec-fill-005935.png",
};

const DOMAINS = {
  "005490":"posco-inc.com","003670":"poscofuturem.com","047050":"poscointl.com","022100":"poscodx.com","058430":"poscosteeleon.com","009520":"poscomtech.com",
  "005930":"samsung.com","000660":"skhynix.com","035420":"navercorp.com","035720":"kakaocorp.com",
  "005935":"samsung.com","402340":"sksquare.com","009150":"samsungsem.com","373220":"lgensol.com","005380":"hyundai.com","207940":"samsungbiologics.com",
  "028260":"samsungcnt.com","032830":"samsunglife.com","105560":"kbfg.com","034020":"doosanenerbility.com","012450":"hanwhaaerospace.com","055550":"shinhan.com",
  "000270":"kia.com","329180":"hd-hhi.com","034730":"sk.com","006400":"samsungsdi.com","068270":"celltrion.com","012330":"mobis.com",
  "086790":"hanafn.com","066570":"lg.com","010120":"ls-electric.com","000810":"samsungfire.com","298040":"hyosungheavyindustries.com","267260":"hd-hyundaielectric.com",
  "042660":"hanwhaocean.com","010130":"koreazinc.co.kr","316140":"woorifg.com","009540":"hd-ksoe.com","042700":"hanmisemi.com","096770":"skinnovation.com",
  "138040":"meritzgroup.com","015760":"kepco.co.kr","000150":"doosan.com","017670":"sktelecom.com","360750":"tigeretf.com","011200":"hmm21.com",
  "051910":"lgchem.com","006800":"miraeasset.com","267250":"hd.com","010140":"samsungshi.com","003550":"lg.co.kr","018260":"samsungsds.com",
  "010950":"s-oil.com","033780":"ktng.com",
  "069500":"samsungfund.com","133690":"tigeretf.com","305720":"samsungfund.com","QQQ":"invesco.com","SPY":"ssga.com",
  "AAPL":"apple.com","MSFT":"microsoft.com","NVDA":"nvidia.com","GOOGL":"abc.xyz","AMZN":"amazon.com","META":"meta.com","TSLA":"tesla.com","AVGO":"broadcom.com","ORCL":"oracle.com","NFLX":"netflix.com","PLTR":"palantir.com",
  "AMD":"amd.com","INTC":"intel.com","QCOM":"qualcomm.com","MU":"micron.com","TXN":"ti.com","ARM":"arm.com","TSM":"tsmc.com","ASML":"asml.com","AMAT":"appliedmaterials.com","LRCX":"lamresearch.com","KLAC":"kla.com","MRVL":"marvell.com","ADI":"analog.com","MCHP":"microchip.com","NXPI":"nxp.com","ON":"onsemi.com",
  "CRM":"salesforce.com","ADBE":"adobe.com","NOW":"servicenow.com","SNOW":"snowflake.com","DDOG":"datadoghq.com","MDB":"mongodb.com","NET":"cloudflare.com","CRWD":"crowdstrike.com","PANW":"paloaltonetworks.com","FTNT":"fortinet.com","ZS":"zscaler.com","OKTA":"okta.com","TEAM":"atlassian.com","WDAY":"workday.com","INTU":"intuit.com","ADSK":"autodesk.com",
  "CSCO":"cisco.com","IBM":"ibm.com","DELL":"dell.com","HPE":"hpe.com","SMCI":"supermicro.com","SAP":"sap.com","SHOP":"shopify.com","UBER":"uber.com","ABNB":"airbnb.com","RBLX":"roblox.com",
};

// 파비콘으로 구분하기 어려운 파생상품·국채·코인은 로컬 SVG로 항상 선명하게 표시한다.
const LOCAL_ICON_SPECS = {
  "055550":{ kind:"company", label:"신한", color:"#0046ff" },
  "012330":{ kind:"company", label:"M", color:"#002c5f" },
  SH10X:{ kind:"index", label:"10X", color:"#db3a55" },
  K200:{ kind:"index", label:"K2", color:"#0066b3" }, KQ150:{ kind:"index", label:"KQ", color:"#008f83" },
  NQ:{ kind:"index", label:"NQ", color:"#7048e8" }, ES:{ kind:"index", label:"ES", color:"#1971c2" },
  YM:{ kind:"index", label:"YM", color:"#364fc7" }, NKD:{ kind:"index", label:"NK", color:"#d9485f" },
  CL:{ kind:"commodity", label:"WTI", color:"#343a40", glyph:"●" }, GC:{ kind:"commodity", label:"AU", color:"#b98500", glyph:"◆" },
  SI:{ kind:"commodity", label:"AG", color:"#74808c", glyph:"◆" }, NG:{ kind:"commodity", label:"GAS", color:"#168b6a", glyph:"♨" },
  HG:{ kind:"commodity", label:"CU", color:"#b65f32", glyph:"⬡" },
  KR2Y:{ kind:"bond", label:"2Y", country:"KR", color:"#1261a0" }, KR3Y:{ kind:"bond", label:"3Y", country:"KR", color:"#1261a0" },
  KR5Y:{ kind:"bond", label:"5Y", country:"KR", color:"#1261a0" }, KR10Y:{ kind:"bond", label:"10Y", country:"KR", color:"#1261a0" },
  KR20Y:{ kind:"bond", label:"20Y", country:"KR", color:"#1261a0" }, KR30Y:{ kind:"bond", label:"30Y", country:"KR", color:"#1261a0" },
  US3M:{ kind:"bond", label:"3M", country:"US", color:"#31558b" }, US2Y:{ kind:"bond", label:"2Y", country:"US", color:"#31558b" },
  US5Y:{ kind:"bond", label:"5Y", country:"US", color:"#31558b" }, US10Y:{ kind:"bond", label:"10Y", country:"US", color:"#31558b" },
  US20Y:{ kind:"bond", label:"20Y", country:"US", color:"#31558b" }, US30Y:{ kind:"bond", label:"30Y", country:"US", color:"#31558b" },
  BTC:{ kind:"crypto", label:"₿", color:"#f7931a" }, ETH:{ kind:"crypto", label:"♦", color:"#627eea" },
  SOL:{ kind:"crypto", label:"S", color:"#7c3aed" }, XRP:{ kind:"crypto", label:"X", color:"#23292f" },
  ADA:{ kind:"crypto", label:"A", color:"#0d6efd" }, DOGE:{ kind:"crypto", label:"Ð", color:"#c2a633" },
  AVAX:{ kind:"crypto", label:"A", color:"#e84142" }, DOT:{ kind:"crypto", label:"●", color:"#e6007a" },
  LINK:{ kind:"crypto", label:"⬡", color:"#2a5ada" }, BCH:{ kind:"crypto", label:"₿", color:"#0ac18e" },
  LTC:{ kind:"crypto", label:"Ł", color:"#345d9d" }, TRX:{ kind:"crypto", label:"T", color:"#ef0027" },
};

// 외부 파비콘을 제공하지 않는 경우에도 신규 코스피 종목을 구분할 수 있는 회사별 로컬 배지다.
const COMPANY_FALLBACK_SPECS = {
  "005930":{ kind:"company", label:"삼성", color:"#1428a0" }, "005935":{ kind:"company", label:"삼성우", color:"#1428a0" }, "402340":{ kind:"company", label:"SK", color:"#e1002a" },
  "009150":{ kind:"company", label:"SEM", color:"#1428a0" }, "373220":{ kind:"company", label:"LG", color:"#a50034" },
  "005380":{ kind:"company", label:"H", color:"#002c5f" }, "207940":{ kind:"company", label:"BIO", color:"#1428a0" },
  "028260":{ kind:"company", label:"물산", color:"#1428a0" }, "032830":{ kind:"company", label:"생명", color:"#1428a0" },
  "105560":{ kind:"company", label:"KB", color:"#ffbc00" }, "034020":{ kind:"company", label:"두산", color:"#005eb8" },
  "012450":{ kind:"company", label:"한화", color:"#f37321" }, "055550":{ kind:"company", label:"신한", color:"#0046ff" },
  "000270":{ kind:"company", label:"KIA", color:"#05141f" }, "329180":{ kind:"company", label:"HD", color:"#003087" },
  "034730":{ kind:"company", label:"SK", color:"#e1002a" }, "006400":{ kind:"company", label:"SDI", color:"#1428a0" },
  "068270":{ kind:"company", label:"셀트", color:"#00a6a6" }, "012330":{ kind:"company", label:"M", color:"#002c5f" },
  "086790":{ kind:"company", label:"하나", color:"#009490" }, "066570":{ kind:"company", label:"LG", color:"#a50034" },
  "010120":{ kind:"company", label:"LS", color:"#005eb8" }, "000810":{ kind:"company", label:"화재", color:"#1428a0" },
  "298040":{ kind:"company", label:"효성", color:"#004098" }, "267260":{ kind:"company", label:"HD", color:"#00a651" },
  "042660":{ kind:"company", label:"한화", color:"#f37321" }, "010130":{ kind:"company", label:"KZ", color:"#0b6b3a" },
  "316140":{ kind:"company", label:"우리", color:"#0067ac" }, "009540":{ kind:"company", label:"HD", color:"#003087" },
  "042700":{ kind:"company", label:"한미", color:"#d71920" }, "096770":{ kind:"company", label:"SK", color:"#e1002a" },
  "138040":{ kind:"company", label:"메리", color:"#8b1e2d" }, "015760":{ kind:"company", label:"한전", color:"#ed1c24" },
  "000150":{ kind:"company", label:"두산", color:"#005eb8" }, "017670":{ kind:"company", label:"T", color:"#e1002a" },
  "360750":{ kind:"company", label:"TIG", color:"#ec1c24" }, "011200":{ kind:"company", label:"HMM", color:"#e31b23" },
  "051910":{ kind:"company", label:"LG", color:"#a50034" }, "006800":{ kind:"company", label:"미래", color:"#f58220" },
  "267250":{ kind:"company", label:"HD", color:"#003087" }, "010140":{ kind:"company", label:"중공", color:"#1428a0" },
  "003550":{ kind:"company", label:"LG", color:"#a50034" }, "018260":{ kind:"company", label:"SDS", color:"#1428a0" },
  "010950":{ kind:"company", label:"S", color:"#00843d" }, "033780":{ kind:"company", label:"KGT", color:"#006747" },
};

function CryptoMark({ symbol }) {
  if (symbol === "ETH") return <><path d="M32 12l-12 20 12 7 12-7z" fill="#fff" /><path d="M20 35l12 17 12-17-12 7z" fill="#fff" opacity=".78" /></>;
  if (symbol === "SOL") return <><path d="M20 18h29l-6 7H14zM14 29h29l6 7H20zM20 40h29l-6 7H14z" fill="#fff" /></>;
  if (symbol === "XRP") return <><path d="M17 19c4 0 6 1 9 5l6 6 6-6c3-4 5-5 9-5" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" /><path d="M17 45c4 0 6-1 9-5l6-6 6 6c3 4 5 5 9 5" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" /></>;
  if (symbol === "ADA") return <><circle cx="32" cy="32" r="4" fill="#fff" /><g fill="#fff" opacity=".92">{[[32,17],[32,47],[17,32],[47,32],[21,21],[43,21],[21,43],[43,43],[25,14],[39,14],[25,50],[39,50],[14,25],[14,39],[50,25],[50,39]].map(([cx,cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.8" />)}</g></>;
  if (symbol === "AVAX") return <><path d="M31 14c1-2 3-2 4 0l13 25c1 2 0 4-3 4H34c-2 0-3-2-2-4l6-11z" fill="#fff" /><path d="M24 33l-5 9c-1 2 0 3 2 3h7c2 0 3-2 2-4l-3-8c-1-2-2-2-3 0z" fill="#fff" /></>;
  if (symbol === "LINK") return <path d="M32 13l17 10v19L32 52 15 42V23zM32 21l-10 6v11l10 6 10-6V27z" fill="#fff" fillRule="evenodd" />;
  if (symbol === "TRX") return <path d="M16 17l33 6-22 27zm5 5l8 21 4-14zm13 8l9-4-19-3z" fill="#fff" fillRule="evenodd" />;
  return null;
}

function LocalAssetIcon({ spec, symbol }) {
  if (spec.kind === "company") return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="7" y="7" width="50" height="50" rx="15" fill={spec.color} />
      <path d="M18 46h28" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".32" />
      <text x="32" y="38" textAnchor="middle" fill="#fff" fontSize={spec.label.length >= 3 ? "13" : "17"} fontWeight="900" letterSpacing="-.5">{spec.label}</text>
    </svg>
  );
  if (spec.kind === "bond") return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="7" y="7" width="50" height="50" rx="15" fill={spec.color} />
      <path d="M19 17h26v30H19z" fill="#fff" opacity=".96" />
      <path d="M24 26h16M24 32h16M24 38h10" stroke={spec.color} strokeWidth="2.5" strokeLinecap="round" />
      <text x="32" y="23" textAnchor="middle" fill={spec.color} fontSize="7" fontWeight="900">{spec.country}</text>
      <rect x="32" y="38" width="18" height="12" rx="6" fill="#f7c948" />
      <text x="41" y="46.5" textAnchor="middle" fill="#273444" fontSize="7" fontWeight="900">{spec.label}</text>
    </svg>
  );
  if (spec.kind === "index") return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="7" y="7" width="50" height="50" rx="15" fill={spec.color} />
      <path d="M16 40l10-9 8 5 14-16" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M42 20h6v6" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <text x="20" y="51" fill="#fff" fontSize="9" fontWeight="900">{spec.label}</text>
    </svg>
  );
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="26" fill={spec.color} />
      <circle cx="32" cy="32" r="21" fill="none" stroke="#fff" strokeWidth="1.5" opacity=".28" />
      {spec.kind === "crypto" && <CryptoMark symbol={symbol} />}
      {(spec.kind !== "crypto" || !["ETH","SOL","XRP","ADA","AVAX","LINK","TRX"].includes(symbol)) && <text x="32" y={spec.kind === "commodity" ? "33" : "40"} textAnchor="middle" fill="#fff" fontSize={spec.kind === "commodity" ? "17" : "25"} fontWeight="900">{spec.glyph || spec.label}</text>}
      {spec.kind === "commodity" && <text x="32" y="47" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="900">{spec.label}</text>}
    </svg>
  );
}

// 종목명 또는 심볼에서 대체 로고에 사용할 최대 두 글자를 만든다.
function initials(asset) {
  if (!asset) return "?";
  const compact = (asset.symbol || asset.name || "?").replace(/[^A-Za-z0-9가-힣]/g, "");
  return compact.slice(0, 2).toUpperCase();
}

// 같은 종목이 항상 같은 배경색을 갖도록 문자열을 HSL 색상값으로 변환한다.
function hashHue(value = "") {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 360;
  return hash;
}

// 국내·해외 종목별 도메인을 Google favicon 주소로 변환한다.
export function assetLogoUrl(asset) {
  const tossLogo = TOSS_SECURITY_LOGOS[asset?.id] || TOSS_SECURITY_LOGOS[asset?.symbol];
  if (tossLogo) return tossLogo;
  const domain = asset?.group === "POSCO"
    ? POSCO_GROUP_DOMAIN
    : DOMAINS[asset?.id] || DOMAINS[asset?.symbol];
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null;
}

// 종목이 바뀌면 실패 상태를 초기화하고 새 로고 로딩을 다시 시도한다.
export default function AssetLogo({ asset, size = "md", className = "" }) {
  const [failed, setFailed] = useState(false);
  const src = assetLogoUrl(asset);
  const localIcon = LOCAL_ICON_SPECS[asset?.id] || LOCAL_ICON_SPECS[asset?.symbol];
  const companyFallback = COMPANY_FALLBACK_SPECS[asset?.id] || COMPANY_FALLBACK_SPECS[asset?.symbol];
  const hue = hashHue(asset?.symbol || asset?.name || "asset");
  const logoKind = localIcon || (failed && companyFallback) ? "asset-logo-local" : src && !failed ? "asset-logo-remote" : "asset-logo-fallback";

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span
      className={`asset-logo asset-logo-${size} ${logoKind} ${className}`.trim()}
      style={{ "--asset-hue": hue }}
      aria-label={`${asset?.name || "종목"} 이미지`}
    >
      {localIcon ? (
        <LocalAssetIcon spec={localIcon} symbol={asset?.symbol} />
      ) : src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : companyFallback ? (
        <LocalAssetIcon spec={companyFallback} symbol={asset?.symbol} />
      ) : (
        <b>{initials(asset)}</b>
      )}
    </span>
  );
}
