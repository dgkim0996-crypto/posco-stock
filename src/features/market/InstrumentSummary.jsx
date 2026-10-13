import AssetLogo from "../../components/AssetLogo.jsx";
import { LABELS } from "./marketConstants.js";
import { assetPrice, signedPercent } from "../../utils/tradingFormatters.js";
import { formatChangeAmount } from "../../utils/marketChange.js";
import React from "react";

export default function InstrumentSummary({
  selected, category, bestAsk, bestBid,
}) {
  return (
    <div className="panel instrument">
      <div className="instrument-identity">
        <AssetLogo asset={selected} size="xl" />
        <div className="instrument-name">
          <span>{LABELS[category]} · {selected.symbol}</span>
          <h1>{selected.name}</h1>
          <div className="badges">
            <b>{selected.market || LABELS[category]}</b>
            <b>{selected.priceSource || "모의투자"}</b>
            {selected.synthetic && <b className="synthetic-badge">일간 10배 · 고위험</b>}
          </div>
        </div>
      </div>

      <div className="quote-summary">
        <div className="price-box">
          <strong>{assetPrice(selected)}</strong>
          {category === "bonds" ? (
            <span className="yield">수익률 {selected.yield.toFixed(2)}%</span>
          ) : (
            <span className={selected.change >= 0 ? "up" : "down"}>
              {formatChangeAmount(selected)} ({signedPercent(selected.change)})
            </span>
          )}
        </div>
        <div className="quote-mini-grid">
          <div><span>매도호가</span><strong className="up">{assetPrice({ ...selected, price: bestAsk })}</strong></div>
          <div><span>매수호가</span><strong className="down">{assetPrice({ ...selected, price: bestBid })}</strong></div>
        </div>
      </div>
    </div>
  );
}
