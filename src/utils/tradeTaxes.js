const KOREAN_OVERSEAS_ETFS = new Set(["360750", "133690"]);

export const TRADE_TAX_RULES_AS_OF = "2026-01-01";

export function feeRateForTrade(category, asset) {
  return category === "stocks" && asset?.unit === "USD" ? 0.0007 : 0.00015;
}

export function immediateSellTaxRates(category, asset) {
  if (category !== "stocks" || asset?.unit !== "KRW" || asset?.group === "ETF" || asset?.synthetic) {
    return { transactionTaxRate: 0, agriculturalTaxRate: 0 };
  }
  if (asset?.market === "KOSDAQ") {
    return { transactionTaxRate: 0.002, agriculturalTaxRate: 0 };
  }
  return { transactionTaxRate: 0.0005, agriculturalTaxRate: 0.0015 };
}

const roundedCharge = (amount, rate) => Math.round(amount * rate * 100) / 100;

/** 주문 시점에 확정 가능한 비용과 연간 정산이 필요한 예상세금을 분리해 계산한다. */
export function estimateTradeTaxes({ category, asset, side, priceKrw, quantity, averagePriceKrw }) {
  const validPrice = Number.isFinite(Number(priceKrw)) && Number(priceKrw) > 0 ? Number(priceKrw) : 0;
  const validQuantity = Number.isFinite(Number(quantity)) && Number(quantity) > 0 ? Number(quantity) : 0;
  const grossAmount = validPrice * validQuantity;
  const feeRate = feeRateForTrade(category, asset);
  const feeAmount = roundedCharge(grossAmount, feeRate);
  const sellRates = side === "SELL"
    ? immediateSellTaxRates(category, asset)
    : { transactionTaxRate: 0, agriculturalTaxRate: 0 };
  const transactionTaxAmount = roundedCharge(grossAmount, sellRates.transactionTaxRate);
  const agriculturalTaxAmount = roundedCharge(grossAmount, sellRates.agriculturalTaxRate);
  const immediateTaxAmount = transactionTaxAmount + agriculturalTaxAmount;
  const estimatedProfit = side === "SELL" && Number.isFinite(Number(averagePriceKrw))
    ? Math.max(0, (validPrice - Number(averagePriceKrw)) * validQuantity - feeAmount)
    : 0;

  let deferredTaxAmount = 0;
  let deferredLabel = "";
  let deferredNote = "";
  if (side === "SELL" && category === "stocks" && asset?.unit === "USD") {
    deferredTaxAmount = roundedCharge(estimatedProfit, 0.22);
    deferredLabel = "해외주식 양도세 예상";
    deferredNote = "연 250만원 기본공제·다른 해외주식 손익통산 전의 거래별 참고액이며 체결 시 차감하지 않습니다.";
  } else if (side === "SELL" && category === "stocks" && KOREAN_OVERSEAS_ETFS.has(asset?.symbol)) {
    deferredTaxAmount = roundedCharge(estimatedProfit, 0.154);
    deferredLabel = "ETF 배당소득세 예상";
    deferredNote = "실제 원천징수는 매매차익과 과표기준가 증가분 중 작은 금액을 사용합니다. 과표기준가가 없어 매매차익 기준으로 추정했습니다.";
  } else if (category === "bonds") {
    deferredLabel = "채권 이자소득세";
    deferredNote = "매매 체결에는 부과하지 않으며 이자 지급 시 지방소득세 포함 15.4%가 원천징수됩니다.";
  }

  return {
    grossAmount,
    feeRate,
    feeAmount,
    ...sellRates,
    transactionTaxAmount,
    agriculturalTaxAmount,
    immediateTaxAmount,
    deferredTaxAmount,
    deferredLabel,
    deferredNote,
    settlementAmount: side === "BUY"
      ? -(grossAmount + feeAmount)
      : grossAmount - feeAmount - immediateTaxAmount,
  };
}
