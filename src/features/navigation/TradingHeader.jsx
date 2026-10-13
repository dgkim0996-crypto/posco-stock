import poscoLogo from "../../assets/posco-ci-blue.png";
import AssetLogo from "../../components/AssetLogo.jsx";
import { displayCategoryLabel } from "../market/marketHelpers.js";
import { assetPrice } from "../../utils/tradingFormatters.js";
import { prefetchInvestmentFeed } from "../feed/feedClient.js";
import React from "react";

const prepareFeed = () => {
  prefetchInvestmentFeed();
  void import("../../pages/InvestmentInfo.jsx");
};

export default function TradingHeader({
  setMainTab, mainTab, headerSearchOpen, setHeaderSearchOpen, headerSearchResults, openSearchResult,
  headerSearchQuery, setHeaderSearchQuery, accountNumber, onSignOut, session, setTheme, theme,
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button type="button" className="brand" onClick={() => setMainTab("trading")} aria-label="POSCO 증권 홈">
          <img className="brand-mark" src={poscoLogo} alt="POSCO" />
          <div className="brand-copy">
            <strong>증권</strong>
            <span>모의투자</span>
          </div>
        </button>

        <nav className="main-nav" aria-label="주요 메뉴">
          <button className={mainTab === "trading" ? "active" : ""} type="button" onClick={() => setMainTab("trading")}>홈</button>
          <button className={mainTab === "info" ? "active" : ""} type="button" onMouseEnter={prepareFeed} onFocus={prepareFeed} onClick={() => setMainTab("info")}>피드</button>
          <button className={mainTab === "products" ? "active" : ""} type="button" onClick={() => setMainTab("products")}>주식 골라보기</button>
          <button className={mainTab === "assets" ? "active" : ""} type="button" onClick={() => setMainTab("assets")}>내 자산</button>
          <button className={mainTab === "banking" ? "active" : ""} type="button" onClick={() => setMainTab("banking")}>뱅킹</button>
          <button className={mainTab === "summary" ? "active" : ""} type="button" onClick={() => setMainTab("summary")}>요약</button>
          <button className={mainTab === "operations" ? "active" : ""} type="button" onClick={() => setMainTab("operations")}>운영 상태</button>
        </nav>

        <div className={`header-actions${mainTab === "summary" ? " summary-actions" : ""}`}>
          <div className="header-summary-search">
            {mainTab === "summary" && (
              <div className="market-clock header-market-clock"><i /> <span>실시간 모의시세</span> <b>장중</b></div>
            )}
            <div
            className={`header-global-search ${headerSearchOpen ? "is-open" : ""}`}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setHeaderSearchOpen(false);
            }}
          >
            {headerSearchOpen && (
              <form
                className="header-search-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (headerSearchResults[0]) openSearchResult(headerSearchResults[0]);
                }}
              >
                <input
                  autoFocus
                  value={headerSearchQuery}
                  onChange={(event) => setHeaderSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setHeaderSearchOpen(false);
                      setHeaderSearchQuery("");
                    }
                  }}
                  placeholder="종목명·코드 검색"
                  aria-label="전체 종목 검색어"
                />
              </form>
            )}
            <button
              type="button"
              className="header-search"
              onClick={() => setHeaderSearchOpen((open) => !open)}
              aria-label={headerSearchOpen ? "종목 검색 닫기" : "종목 검색"}
              aria-expanded={headerSearchOpen}
            >⌕</button>
            {headerSearchOpen && headerSearchQuery.trim() && (
              <div className="header-search-results" role="listbox" aria-label="종목 검색 결과">
                {headerSearchResults.length ? headerSearchResults.map((result) => (
                  <button
                    type="button"
                    key={`${result.category}:${result.asset.id}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openSearchResult(result)}
                    role="option"
                  >
                    <AssetLogo asset={result.asset} size="xs" />
                    <span><strong>{result.asset.name}</strong><em>{result.asset.symbol} · {displayCategoryLabel(result.category, result.asset)}</em></span>
                    <b>{assetPrice(result.asset)}</b>
                  </button>
                )) : <div className="header-search-empty">검색 결과가 없습니다.</div>}
              </div>
            )}
            </div>
          </div>
          <button type="button" className="account-mini" onClick={() => setMainTab("assets")}>
            <span>모의계좌</span>
            <strong>{accountNumber}</strong>
          </button>
          <button type="button" className="logout-button" onClick={onSignOut} title={session.user.email}>로그아웃</button>
          <button type="button" className="theme-toggle" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"} aria-pressed={theme === "dark"} title={theme === "dark" ? "라이트 모드" : "다크 모드"}>
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
