import { useMemo } from "react";
import { spotPriceInKRW } from "../market/marketHelpers.js";
import { SIMULATED_USD_KRW as USD_KRW } from "../../../shared/tradingRules.js";

/**
 * 선물 포지션 평가손익(원화). 개설 시 서버가 저장한 원화 환산 승수를 써야 DB 청산 손익과 같아진다.
 * 종목 시세를 찾지 못하면 null을 반환한다.
 */
export function futuresPositionPnl(position, asset) {
  if (!asset || !Number.isFinite(asset.price)) return null;
  const multiplier = Number(position.multiplier) || asset.multiplier;
  const direction = position.side === "LONG" ? 1 : -1;
  return (asset.price - position.entryPrice) * multiplier * position.quantity * direction;
}

// 기존 거래 화면의 상태와 처리 순서를 기능 단위로 캡슐화한다.
export function usePortfolio({
  spotPositions, allAssets, futuresPositions, markets, shortPositions, financeAccount, cash, foreignCash,
}) {
  const spotValue = useMemo(() => {
    return Object.entries(spotPositions).reduce((sum, [id, pos]) => {
      const asset = allAssets.find((x) => x.id === id);
      return sum + (asset ? spotPriceInKRW(asset) * pos.quantity : 0);
    }, 0);
  }, [spotPositions, allAssets]);

  const spotCost = useMemo(() => {
    return Object.values(spotPositions).reduce(
      (sum, pos) => sum + pos.avgPrice * pos.quantity,
      0,
    );
  }, [spotPositions]);

  const futuresPnl = useMemo(() => {
    return futuresPositions.reduce((sum, pos) => {
      const asset = markets.futures.find((x) => x.id === pos.assetId);
      return sum + (futuresPositionPnl(pos, asset) ?? 0);
    }, 0);
  }, [futuresPositions, markets]);

  const marginTotal = useMemo(
    () => futuresPositions.reduce((sum, pos) => sum + pos.margin, 0),
    [futuresPositions],
  );

  const lendingUsed = useMemo(() => Object.entries(shortPositions).reduce((sum, [id, pos]) => {
    const asset = allAssets.find((item) => item.id === id);
    return sum + (asset ? spotPriceInKRW(asset) * pos.quantity : 0);
  }, 0), [shortPositions, allAssets]);

  const lendingPnl = useMemo(() => Object.entries(shortPositions).reduce((sum, [id, pos]) => {
    const asset = allAssets.find((item) => item.id === id);
    return sum + (asset ? (pos.avgPrice - spotPriceInKRW(asset)) * pos.quantity : 0);
  }, 0), [shortPositions, allAssets]);

  const financeDebt = financeAccount.credit.debt + financeAccount.margin.debt + financeAccount.collateral.debt;

  const lendingCollateral = financeAccount.lending.locked;

  const totalAssets = cash + foreignCash * USD_KRW + spotValue + marginTotal + futuresPnl + lendingCollateral - financeDebt - lendingUsed;

  const totalPnl = spotValue - spotCost + futuresPnl + lendingPnl;

  const totalReturn = spotCost > 0 ? ((spotValue - spotCost + futuresPnl) / spotCost) * 100 : 0;

  return {
    spotValue, spotCost, futuresPnl, marginTotal, lendingUsed, financeDebt, lendingCollateral,
    totalAssets, totalPnl, totalReturn,
  };
}
