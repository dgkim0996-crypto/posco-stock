import { useState, useMemo } from "react";
import { INITIAL_MARKETS } from "../../data/markets.js";
import { marketCategoryOf, isStockCategory, stockRegionOf } from "../market/marketHelpers.js";
import { assetMatchesSearch } from "../../utils/assetSearch.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useTradingNavigation({
  markets, setQuantity,
}) {
  const [mainTab, setMainTab] = useState("trading");

  const [category, setCategory] = useState("domesticStocks");

  const [selectedId, setSelectedId] = useState(INITIAL_MARKETS.stocks[0].id);

  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);

  const [headerSearchQuery, setHeaderSearchQuery] = useState("");

  const marketCategory = marketCategoryOf(category);

  const categoryAssets = markets[marketCategory] ?? [];

  const assets = isStockCategory(category)
    ? categoryAssets.filter((asset) => stockRegionOf(asset) === (category === "domesticStocks" ? "domestic" : "overseas"))
    : categoryAssets;

  const selected = assets.find((a) => a.id === selectedId) ?? assets[0];

  const headerSearchResults = useMemo(() => {
    if (!headerSearchQuery.trim()) return [];
    return Object.entries(markets).flatMap(([assetCategory, list]) => list.map((asset) => ({
      asset,
      category: assetCategory,
    }))).filter(({ asset }) => assetMatchesSearch(asset, headerSearchQuery)).slice(0, 8);
  }, [markets, headerSearchQuery]);

  function goTrading(nextCategory = "stocks", assetId = null) {
    setMainTab("trading");
    const list = markets[marketCategoryOf(nextCategory)] ?? markets.stocks;
    const target = assetId ? list.find((item) => item.id === assetId) : null;
    if (nextCategory === "stocks") {
      const nextRegion = target ? stockRegionOf(target) : "domestic";
      const regionalList = list.filter((asset) => stockRegionOf(asset) === nextRegion);
      setCategory(nextRegion === "domestic" ? "domesticStocks" : "overseasStocks");
      setSelectedId(target?.id ?? regionalList[0]?.id ?? INITIAL_MARKETS.stocks[0].id);
    } else {
      setCategory(nextCategory);
      setSelectedId(target?.id ?? list[0]?.id ?? INITIAL_MARKETS.stocks[0].id);
    }
    setQuantity(nextCategory === "crypto" ? "0.01" : "1");
  }

  function openStockFromInfo(assetId) {
    goTrading("stocks", assetId);
  }

  function openSearchResult(result) {
    goTrading(result.category, result.asset.id);
    setHeaderSearchQuery("");
    setHeaderSearchOpen(false);
  }

  return {
    mainTab, setMainTab, category, setCategory, setSelectedId, headerSearchOpen, setHeaderSearchOpen,
    headerSearchQuery, setHeaderSearchQuery, marketCategory, assets, selected, headerSearchResults,
    goTrading, openStockFromInfo, openSearchResult,
  };
}
