import { useOrderNotifications } from "../features/trading/useOrderNotifications.js";
import { useMarketData } from "../features/market/useMarketData.js";
import { useOrderInput } from "../features/trading/useOrderInput.js";
import { useTradingNavigation } from "../features/navigation/useTradingNavigation.js";
import { useTradingPreferences } from "../features/preferences/useTradingPreferences.js";
import { useAccount } from "../features/account/useAccount.js";
import { useRealtimeQuote } from "../features/market/useRealtimeQuote.js";
import { useChartHistory } from "../features/chart/useChartHistory.js";
import { useFavorites } from "../features/favorites/useFavorites.js";
import { useDashboardLayout } from "../features/dashboard/useDashboardLayout.js";
import { usePortfolio } from "../features/account/usePortfolio.js";
import { useOrderForm } from "../features/trading/useOrderForm.js";
import { useSpotOrders } from "../features/trading/useSpotOrders.js";
import { useFuturesOrders } from "../features/trading/useFuturesOrders.js";
import { useOrderReview } from "../features/trading/useOrderReview.js";
import { useAccountReset } from "../features/account/useAccountReset.js";

// 각 상태의 소유자는 하나의 기능 훅이다. 여기서는 훅 간 입력과 화면 출력을 조립한다.
export function useTradingModel(session) {
  const {
    trades, setTrades, message, setMessage, orderToasts, pushTrade, notifyOrder, dismissOrderToast,
  } = useOrderNotifications();
  const {
    markets, setMarkets, marketDataStatus, marketIndices, allAssets,
  } = useMarketData();
  const {
    orderTab, setOrderTab, orderSide, setOrderSide, orderType, setOrderType, limitPrice, setLimitPrice,
    orderDialog, setOrderDialog, orderBusy, setOrderBusy, busyOrderId, setBusyOrderId, marketClock,
    quantity, setQuantity,
  } = useOrderInput();
  const {
    mainTab, setMainTab, category, setCategory, setSelectedId, headerSearchOpen, setHeaderSearchOpen,
    headerSearchQuery, setHeaderSearchQuery, marketCategory, assets, selected, headerSearchResults,
    goTrading, openStockFromInfo, openSearchResult,
  } = useTradingNavigation({
    markets, setQuantity,
  });
  const {
    theme, setTheme, showWelcomeGuide, dismissWelcomeGuide, startFirstTrade,
  } = useTradingPreferences({
    session, setMainTab, setCategory, setSelectedId, setOrderTab,
  });
  const {
    foreignCash, setForeignCash, cash, setCash, accountNumber, financeAccount, setFinanceAccount,
    spotPositions, setSpotPositions, shortPositions, setShortPositions, futuresPositions,
    setFuturesPositions, pendingOrders, setPendingOrders, filledOrders, setFilledOrders, accountOrders,
    setAccountOrders, accountReady, accountLoading, accountError, matchingStatus, orderMutationLock,
    accountRequestVersion, ledgerEntries, orderEvents, settlements, riskStatus, refreshAccount,
  } = useAccount({
    mainTab, notifyOrder, setMessage,
  });
  const {
    realtimeStatus, orderBook,
  } = useRealtimeQuote({
    category, selected, setMarkets,
  });
  const {
    chartData, setChartData, chartPeriod, setChartPeriod, chartIndicators, setChartIndicators,
    chartLoading, chartError,
  } = useChartHistory({
    selected, category, marketCategory,
  });
  const {
    favorites, toggleFavorite,
  } = useFavorites({
    session, setMessage,
  });
  const {
    dashboardWidgets, editDashboard, setEditDashboard, draggingWidget, setDraggingWidget, dragOverWidget,
    setDragOverWidget, resizingWidget, updateDashboardWidget, startDashboardResize, moveDashboardWidget,
    resetDashboardLayout,
  } = useDashboardLayout();
  const {
    spotValue, spotCost, futuresPnl, marginTotal, lendingUsed, financeDebt, lendingCollateral,
    totalAssets, totalPnl, totalReturn,
  } = usePortfolio({
    spotPositions, allAssets, futuresPositions, markets, shortPositions, financeAccount, cash,
    foreignCash,
  });
  const {
    bestAsk, bestBid, domesticSession, orderAvailability, selectedOwnedQuantity, selectedAveragePrice,
    orderTaxPreview, selectedTradeMarkers, setMaximumOrderQuantity,
  } = useOrderForm({
    category, setSelectedId, setQuantity, setOrderType, setLimitPrice, orderType, selected, orderBook,
    marketClock, cash, pendingOrders, allAssets, spotPositions, marketCategory, orderSide, limitPrice,
    futuresPositions, shortPositions, quantity, filledOrders, setMessage, financeAccount, lendingUsed,
  });
  const {
    addFilledOrder, placeSpotOrder, cancelPendingOrder, amendPendingOrder,
  } = useSpotOrders({
    setFilledOrders, allAssets, setCash, setSpotPositions, setShortPositions, pushTrade, notifyOrder,
    pendingOrders, spotPositions, category, financeAccount, lendingUsed, setPendingOrders, setOrderTab,
  });
  const {
    openFuture, closeFuture,
  } = useFuturesOrders({
    notifyOrder, setCash, setFuturesPositions, addFilledOrder, category, pushTrade, futuresPositions,
    orderMutationLock, accountRequestVersion, setOrderBusy, refreshAccount,
  });
  const {
    reviewOrder, reviewPendingOrder, submitReviewedOrder,
  } = useOrderReview({
    accountReady, accountLoading, orderMutationLock, quantity, orderType, category, limitPrice, selected,
    marketCategory, orderTaxPreview, orderSide, orderAvailability, financeAccount, notifyOrder,
    setOrderDialog, accountNumber, allAssets, orderDialog, accountRequestVersion, setOrderBusy,
    setBusyOrderId, amendPendingOrder, cancelPendingOrder, openFuture, placeSpotOrder, refreshAccount,
  });
  const {
    reset,
  } = useAccountReset({
    orderMutationLock, accountRequestVersion, setOrderBusy, setMarkets, setCash, setForeignCash,
    setFinanceAccount, setSpotPositions, setShortPositions, setFuturesPositions, setTrades,
    setPendingOrders, setFilledOrders, setAccountOrders, setOrderTab, setOrderSide, setOrderType,
    setLimitPrice, setChartData, setCategory, setSelectedId, setQuantity, setMessage, refreshAccount,
  });
  return {
    orderToasts, dismissOrderToast, setMainTab, mainTab, headerSearchOpen, setHeaderSearchOpen,
    headerSearchResults, openSearchResult, headerSearchQuery, setHeaderSearchQuery, accountNumber,
    setTheme, theme, realtimeStatus, marketDataStatus, selected, riskStatus, totalAssets, cash, totalPnl,
    totalReturn, reset, domesticSession, orderAvailability, refreshAccount, accountLoading, orderBusy,
    busyOrderId, accountError, matchingStatus, category, setCategory, assets, setSelectedId,
    marketCategory, favorites, toggleFavorite, bestAsk, bestBid, chartPeriod, setChartPeriod,
    chartIndicators, setChartIndicators, chartLoading, chartData, chartError, selectedAveragePrice,
    selectedTradeMarkers, orderTab, setOrderTab, pendingOrders, filledOrders, orderSide, setOrderSide,
    orderBook, setOrderType, setLimitPrice, orderType, limitPrice, quantity, setQuantity,
    setMaximumOrderQuantity, selectedOwnedQuantity, financeAccount, lendingUsed, orderTaxPreview,
    accountReady, reviewOrder, message, allAssets, reviewPendingOrder, accountOrders, markets, goTrading,
    spotValue, marginTotal, futuresPnl, spotPositions, shortPositions, futuresPositions, closeFuture,
    trades, editDashboard, resetDashboardLayout, setEditDashboard, dashboardWidgets,
    updateDashboardWidget, dragOverWidget, resizingWidget, setDragOverWidget, draggingWidget,
    moveDashboardWidget, setDraggingWidget, startDashboardResize, foreignCash, spotCost, financeDebt,
    lendingCollateral, orderEvents, ledgerEntries, settlements, marketIndices, openStockFromInfo, setCash,
    setForeignCash, setFinanceAccount, showWelcomeGuide, dismissWelcomeGuide, startFirstTrade,
    orderDialog, setOrderDialog, submitReviewedOrder,
  };
}
