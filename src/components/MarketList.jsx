import React, { useMemo, useState } from "react";
import AssetLogo from "./AssetLogo.jsx";
import { assetMatchesSearch } from "../utils/assetSearch.js";

// 상품 검색, 선택 상태, 현재가와 등락률을 렌더링하는 왼쪽 시장 목록이다.

// 상품 통화 단위에 맞춰 목록용 가격 문자열을 만든다.
function priceText(asset) {
  if (asset.unit === "PTS") {
    return asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (asset.unit === "USD") {
    return `$${asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(asset.price).toLocaleString()}원`;
}

export default function MarketList({ assets, selectedId, onSelect, type, favorites, onToggleFavorite }) {
  const [keyword, setKeyword] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  // 공통 검색 규칙으로 종목명·코드·시장·그룹을 검색한다.
  const filteredAssets = useMemo(() => {
    return assets
      .filter((asset) => assetMatchesSearch(asset, keyword))
      .filter((asset) => !favoritesOnly || favorites.has(asset.id))
      .sort((a, b) => {
        if (type === "stocks") {
          const aRank = Number.isFinite(a.kospiRank) ? a.kospiRank : Number.MAX_SAFE_INTEGER;
          const bRank = Number.isFinite(b.kospiRank) ? b.kospiRank : Number.MAX_SAFE_INTEGER;
          if (aRank !== bRank) return aRank - bRank;
        }
        return Number(favorites.has(b.id)) - Number(favorites.has(a.id));
      });
  }, [assets, keyword, favorites, favoritesOnly, type]);

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

      <button type="button" className={`favorites-filter ${favoritesOnly ? "active" : ""}`} onClick={() => setFavoritesOnly((only) => !only)} aria-pressed={favoritesOnly}>
        <span aria-hidden="true">★</span> 즐겨찾기만
        <b>{assets.filter((asset) => favorites.has(asset.id)).length}</b>
      </button>

      <div className="market-list">
        <div className="market-columns">
          <span>종목</span><span>현재가 / 등락</span>
        </div>

        {filteredAssets.length === 0 ? (
          <div className="search-empty">검색 결과가 없습니다.</div>
        ) : filteredAssets.map((asset) => (
          <div
            key={asset.id}
            className={`market-row ${selectedId === asset.id ? "active" : ""}`}
            onClick={() => onSelect(asset.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect(asset.id);
            }}
          >
            <div className="market-identity">
              <AssetLogo asset={asset} size="sm" />
              <div>
                <strong>{asset.name}</strong>
                <span>{asset.symbol}{asset.market ? ` · ${asset.market}` : ""}{asset.group === "POSCO" ? " · POSCO" : ""}{asset.kospiRank ? ` · 시총 ${asset.kospiRank}위` : ""}</span>
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
            <button type="button" className={`favorite-button ${favorites.has(asset.id) ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); onToggleFavorite(asset.id); }} aria-label={`${asset.name} ${favorites.has(asset.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}`} aria-pressed={favorites.has(asset.id)} title={favorites.has(asset.id) ? "즐겨찾기 해제" : "즐겨찾기 추가"}>★</button>
          </div>
        ))}
      </div>
    </>
  );
}
