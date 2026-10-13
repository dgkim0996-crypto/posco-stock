import { useState, useEffect } from "react";
import { loadTheme, shouldShowWelcomeGuide, writeStorage } from "./preferenceStorage.js";
import { WELCOME_GUIDE_STORAGE_PREFIX, THEME_STORAGE_KEY } from "./storageKeys.js";
import { INITIAL_MARKETS } from "../../data/markets.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useTradingPreferences({
  session, setMainTab, setCategory, setSelectedId, setOrderTab,
}) {
  const [theme, setTheme] = useState(loadTheme);

  const [showWelcomeGuide, setShowWelcomeGuide] = useState(() => shouldShowWelcomeGuide(session.user.id));

  function dismissWelcomeGuide() {
    writeStorage(`${WELCOME_GUIDE_STORAGE_PREFIX}:${session.user.id}`, "dismissed");
    setShowWelcomeGuide(false);
  }

  function startFirstTrade() {
    setMainTab("trading");
    setCategory("domesticStocks");
    setSelectedId(INITIAL_MARKETS.stocks[0].id);
    setOrderTab("order");
    dismissWelcomeGuide();
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return {
    theme, setTheme, showWelcomeGuide, dismissWelcomeGuide, startFirstTrade,
  };
}
