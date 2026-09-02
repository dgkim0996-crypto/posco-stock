import React, { useEffect, useState } from "react";

const POSCO_GROUP_DOMAIN = "poscofuturem.com";

const DOMAINS = {
  "005490":"posco-inc.com","003670":"poscofuturem.com","047050":"poscointl.com","022100":"poscodx.com","058430":"poscosteeleon.com","009520":"poscomtech.com",
  "005930":"samsung.com","000660":"skhynix.com","035420":"navercorp.com","035720":"kakaocorp.com",
  "069500":"samsungfund.com","133690":"tigeretf.com","305720":"samsungfund.com","QQQ":"invesco.com","SPY":"ssga.com",
  "AAPL":"apple.com","MSFT":"microsoft.com","NVDA":"nvidia.com","GOOGL":"abc.xyz","AMZN":"amazon.com","META":"meta.com","TSLA":"tesla.com","AVGO":"broadcom.com","ORCL":"oracle.com","NFLX":"netflix.com","PLTR":"palantir.com",
  "AMD":"amd.com","INTC":"intel.com","QCOM":"qualcomm.com","MU":"micron.com","TXN":"ti.com","ARM":"arm.com","TSM":"tsmc.com","ASML":"asml.com","AMAT":"appliedmaterials.com","LRCX":"lamresearch.com","KLAC":"kla.com","MRVL":"marvell.com","ADI":"analog.com","MCHP":"microchip.com","NXPI":"nxp.com","ON":"onsemi.com",
  "CRM":"salesforce.com","ADBE":"adobe.com","NOW":"servicenow.com","SNOW":"snowflake.com","DDOG":"datadoghq.com","MDB":"mongodb.com","NET":"cloudflare.com","CRWD":"crowdstrike.com","PANW":"paloaltonetworks.com","FTNT":"fortinet.com","ZS":"zscaler.com","OKTA":"okta.com","TEAM":"atlassian.com","WDAY":"workday.com","INTU":"intuit.com","ADSK":"autodesk.com",
  "CSCO":"cisco.com","IBM":"ibm.com","DELL":"dell.com","HPE":"hpe.com","SMCI":"supermicro.com","SAP":"sap.com","SHOP":"shopify.com","UBER":"uber.com","ABNB":"airbnb.com","RBLX":"roblox.com",
  "K200":"krx.co.kr","NQ":"cmegroup.com","ES":"cmegroup.com","CL":"cmegroup.com","GC":"cmegroup.com",
  "KR3Y":"moef.go.kr","KR10Y":"moef.go.kr","US2Y":"treasury.gov","US10Y":"treasury.gov","US30Y":"treasury.gov",
  "BTC":"bitcoin.org","ETH":"ethereum.org","SOL":"solana.com","XRP":"xrpl.org"
};

function initials(asset) {
  if (!asset) return "?";
  const compact = (asset.symbol || asset.name || "?").replace(/[^A-Za-z0-9가-힣]/g, "");
  return compact.slice(0, 2).toUpperCase();
}

function hashHue(value = "") {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 360;
  return hash;
}

export function assetLogoUrl(asset) {
  const domain = asset?.group === "POSCO"
    ? POSCO_GROUP_DOMAIN
    : DOMAINS[asset?.id] || DOMAINS[asset?.symbol];
  return domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null;
}

export default function AssetLogo({ asset, size = "md", className = "" }) {
  const [failed, setFailed] = useState(false);
  const src = assetLogoUrl(asset);
  const hue = hashHue(asset?.symbol || asset?.name || "asset");

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span
      className={`asset-logo asset-logo-${size} ${className}`.trim()}
      style={{ "--asset-hue": hue }}
      aria-label={`${asset?.name || "종목"} 이미지`}
    >
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <b>{initials(asset)}</b>
      )}
    </span>
  );
}
