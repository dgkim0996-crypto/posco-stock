import React, { useMemo, useState } from "react";
import AssetLogo from "./AssetLogo.jsx";

function priceText(asset) {
  if (asset.unit === "PTS") {
    return asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (asset.unit === "USD") {
    return `$${asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(asset.price).toLocaleString()}원`;
}

export default function MarketList({ assets, selectedId, onSelect, type }) {
  const [keyword, setKeyword] = useState("");

  const filteredAssets = useMemo(() => {
    const query = keyword.trim().toLowerCase().replace(/[\s-]/g, "");
    if (!query) return assets;
    const numericQuery = /^\d+$/.test(query) ? query.replace(/^0+/, "") || "0" : null;
    return assets.filter((asset) => {
      const name = asset.name.toLowerCase().replace(/\s/g, "");
      const symbol = String(asset.symbol).toLowerCase().replace(/[\s-]/g, "");
      const numericSymbol = /^\d+$/.test(symbol) ? symbol.replace(/^0+/, "") || "0" : null;
      return name.includes(query)
        || symbol.includes(query)
        || (numericQuery !== null && numericSymbol?.includes(numericQuery));
    });
  }, [assets, keyword]);

  return (
    <>
      <div className="stock-search">
        <span>⌕</span>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="종목명·코드 검색"
        />
      </div>

      <div className="market-list">
        <div className="market-columns">
          <span>종목</span><span>현재가 / 등락</span>
        </div>

        {filteredAssets.length === 0 ? (
          <div className="search-empty">검색 결과가 없습니다.</div>
        ) : filteredAssets.map((asset) => (
          <button
            key={asset.id}
            className={`market-row ${selectedId === asset.id ? "active" : ""}`}
            onClick={() => onSelect(asset.id)}
          >
            <div className="market-identity">
              <AssetLogo asset={asset} size="sm" />
              <div>
                <strong>{asset.name}</strong>
                <span>{asset.symbol}{asset.market ? ` · ${asset.market}` : ""}{asset.group === "POSCO" ? " · POSCO" : ""}</span>
              </div>
            </div>
            <div className="market-right">
              <strong>{priceText(asset)}</strong>
              {type === "bonds" ? (
                <span className="yield">YTM {asset.yield.toFixed(2)}%</span>
              ) : (
                <span className={asset.change >= 0 ? "up" : "down"}>
                  {asset.change >= 0 ? "+" : ""}{asset.change.toFixed(2)}%
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
