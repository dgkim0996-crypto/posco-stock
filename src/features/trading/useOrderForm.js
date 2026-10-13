import { useEffect, useMemo } from "react";
import { INITIAL_MARKETS } from "../../data/markets.js";
import { marketCategoryOf, isStockCategory, stockRegionOf, spotPriceInKRW } from "../market/marketHelpers.js";
import { normalizeOrderPrice, stepOrderPrice, getDomesticMarketSession, calculateOrderAvailability, SIMULATED_USD_KRW as USD_KRW } from "../../../shared/tradingRules.js";
import { estimateTradeTaxes } from "../../utils/tradeTaxes.js";

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function useOrderForm({
  category, setSelectedId, setQuantity, setOrderType, setLimitPrice, orderType, selected, orderBook,
  marketClock, cash, pendingOrders, allAssets, spotPositions, marketCategory, orderSide, limitPrice,
  futuresPositions, shortPositions, quantity, filledOrders, setMessage, financeAccount, lendingUsed,
}) {
  useEffect(() => {
    const fullList = INITIAL_MARKETS[marketCategoryOf(category)];
    const list = isStockCategory(category)
      ? fullList.filter((asset) => stockRegionOf(asset) === (category === "domesticStocks" ? "domestic" : "overseas"))
      : fullList;
    setSelectedId((prev) => list.some((item) => item.id === prev) ? prev : list[0].id);
    setQuantity(category === "crypto" ? "0.01" : "1");
    setOrderType("MARKET");
    setLimitPrice("");
  }, [category]);

  useEffect(() => {
    if (orderType === "LIMIT") setLimitPrice(String(normalizeOrderPrice(selected, selected.price)));
  }, [selected.id]);

  const bestAsk = orderBook?.symbol === selected.symbol && Number.isFinite(orderBook.asks?.[0]?.price) ? orderBook.asks[0].price : stepOrderPrice(selected, selected.price, "up");

  const bestBid = orderBook?.symbol === selected.symbol && Number.isFinite(orderBook.bids?.[0]?.price) ? orderBook.bids[0].price : stepOrderPrice(selected, selected.price, "down");

  const domesticSession = getDomesticMarketSession(marketClock);

  const orderAvailability = calculateOrderAvailability({ cash, pendingOrders, assets: allAssets, positions: spotPositions, selected, category: marketCategory, side: orderSide, price: orderType === "LIMIT" ? Number(limitPrice) : selected.price });

  const selectedOwnedQuantity = Number(spotPositions[selected.id]?.quantity) || 0;

  const selectedPendingSellQuantity = pendingOrders
    .filter((item) => item.assetId === selected.id && item.side === "SELL")
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const selectedAveragePrice = useMemo(() => {
    if (category === "futures") {
      const positions = futuresPositions.filter((position) => position.assetId === selected.id || position.symbol === selected.symbol);
      const totalQuantity = positions.reduce((sum, position) => sum + Number(position.quantity || 0), 0);
      if (totalQuantity <= 0) return null;
      return positions.reduce((sum, position) => sum + Number(position.entryPrice || 0) * Number(position.quantity || 0), 0) / totalQuantity;
    }

    const position = spotPositions[selected.id] || shortPositions[selected.id];
    const averagePrice = Number(position?.avgPrice);
    if (!Number.isFinite(averagePrice) || averagePrice <= 0) return null;
    return selected.unit === "USD" ? averagePrice / USD_KRW : averagePrice;
  }, [category, futuresPositions, selected.id, selected.symbol, selected.unit, shortPositions, spotPositions]);

  const orderTaxPreview = useMemo(() => {
    const requestedPrice = orderType === "LIMIT" ? Number(limitPrice) : Number(selected.price);
    const priceKrw = Number.isFinite(requestedPrice)
      ? spotPriceInKRW({ ...selected, price: requestedPrice })
      : 0;
    return estimateTradeTaxes({
      category: marketCategory,
      asset: selected,
      side: orderSide,
      priceKrw,
      quantity: Number(quantity),
      averagePriceKrw: Number(spotPositions[selected.id]?.avgPrice),
    });
  }, [category, limitPrice, orderSide, orderType, quantity, selected, spotPositions]);

  const selectedTradeMarkers = useMemo(() => filledOrders
    .filter((order) => order.assetId === selected.id || order.symbol === selected.symbol)
    .slice(0, 30)
    .map((order) => ({
      id: order.id,
      side: order.side,
      price: Number(order.executionPrice),
      quantity: Number(order.quantity),
      time: Number(order.filledAtTime) || Date.parse(order.updatedAt || order.createdAt),
    }))
    .filter((marker) => Number.isFinite(marker.price) && marker.price > 0 && Number.isFinite(marker.time)),
  [filledOrders, selected.id, selected.symbol]);

  function setMaximumOrderQuantity(fraction = 1) {
    if (category === "futures") {
      const marginPerContract = selected.price * selected.multiplier * selected.marginRate;
      const maximum = marginPerContract > 0 ? Math.floor(orderAvailability.availableCash / marginPerContract * fraction) : 0;
      setQuantity(String(maximum));
      setMessage(maximum > 0
        ? `${orderSide === "BUY" ? "매수" : "매도"} 증거금 기준 최대 ${maximum}계약입니다.`
        : `현재 현금으로 ${orderSide === "BUY" ? "매수" : "매도"} 가능한 계약이 없습니다.`);
      return;
    }

    const requestedPrice = orderType === "LIMIT" ? Number(limitPrice) : selected.price;
    if (!Number.isFinite(requestedPrice) || requestedPrice <= 0) {
      setMessage("최대 수량을 계산하려면 주문가격을 먼저 입력해 주세요.");
      return;
    }

    const unitPrice = spotPriceInKRW({ ...selected, price: requestedPrice });
    let maximum;

    if (orderSide === "SELL") {
      // 보유-미체결 매도 차이는 calculateOrderAvailability가 8자리로 정리한 값을 쓴다(0.3-0.1=0.19999999999999998 방지).
      maximum = orderAvailability.availableSellQuantity;
      if (isStockCategory(category) && financeAccount.lending.active) {
        const pendingShortQuantity = Math.max(0, selectedPendingSellQuantity - selectedOwnedQuantity);
        const pendingShortAmount = pendingShortQuantity * unitPrice;
        const availableLendingAmount = Math.max(0, financeAccount.lending.limit - lendingUsed - pendingShortAmount);
        maximum += unitPrice > 0 ? Math.floor(availableLendingAmount / unitPrice) : 0;
      }
    } else {
      maximum = orderAvailability.maxQuantity;
    }

    maximum *= fraction;
    // 0.29*1e8=28999999.999999996처럼 단위 환산 오차로 마지막 1단위가 버려지지 않게 먼저 정리한 뒤 내림한다.
    const precision = category === "crypto" ? 100000000 : 1;
    maximum = Math.floor(Number((maximum * precision).toFixed(6))) / precision;

    setQuantity(String(maximum));
    setMessage(maximum > 0
      ? `${orderSide === "BUY" ? "매수가능금액" : "매도가능수량"}의 ${Math.round(fraction * 100)}% · ${maximum.toLocaleString()}입니다.`
      : `현재 ${orderSide === "BUY" ? "매수" : "매도"} 가능한 수량이 없습니다.`);
  }

  return {
    bestAsk, bestBid, domesticSession, orderAvailability, selectedOwnedQuantity, selectedAveragePrice,
    orderTaxPreview, selectedTradeMarkers, setMaximumOrderQuantity,
  };
}
