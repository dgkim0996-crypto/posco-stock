import { lazy, Suspense } from "react";
import { SIMULATED_USD_KRW as USD_KRW } from "../../shared/tradingRules.js";
import { spotPriceInKRW } from "../features/market/marketHelpers.js";
import { assetPrice } from "../utils/tradingFormatters.js";

const AssetOverview = lazy(() => import("../pages/AssetOverview.jsx"));
const InvestmentInfo = lazy(() => import("../pages/InvestmentInfo.jsx"));
const Products = lazy(() => import("../pages/Products.jsx"));
const Banking = lazy(() => import("../pages/Banking.jsx"));
const MarketSummary = lazy(() => import("../pages/MarketSummary.jsx"));
const Operations = lazy(() => import("../pages/Operations.jsx"));

export default function SecondaryPages({
  mainTab, cash, foreignCash, spotPositions, futuresPositions, allAssets, spotValue, spotCost, futuresPnl,
  marginTotal, totalAssets, totalPnl, totalReturn, financeDebt, lendingCollateral, lendingUsed,
  orderEvents, ledgerEntries, settlements, goTrading, markets, marketIndices, openStockFromInfo, setCash,
  setForeignCash, financeAccount, setFinanceAccount,
}) {
  return (
    <Suspense fallback={<main className="page-loading">화면을 불러오고 있습니다...</main>}>
    {mainTab === "assets" && (
      <AssetOverview
        cash={cash}
        foreignCash={foreignCash}
        usdKrw={USD_KRW}
        spotPositions={spotPositions}
        futuresPositions={futuresPositions}
        allAssets={allAssets}
        spotValue={spotValue}
        spotCost={spotCost}
        futuresPnl={futuresPnl}
        marginTotal={marginTotal}
        totalAssets={totalAssets}
        totalPnl={totalPnl}
        totalReturn={totalReturn}
        financeDebt={financeDebt}
        lendingCollateral={lendingCollateral}
        lendingUsed={lendingUsed}
        spotPriceInKRW={spotPriceInKRW}
        assetPrice={assetPrice}
        orderEvents={orderEvents}
        ledgerEntries={ledgerEntries}
        settlements={settlements}
        onGoTrading={goTrading}
      />
    )}

    {mainTab === "info" && <InvestmentInfo markets={markets} indices={marketIndices} onOpenAsset={openStockFromInfo} />}
    {mainTab === "products" && <Products onGoTrading={goTrading} markets={markets} indices={marketIndices} />}
    {mainTab === "banking" && (
      <Banking
        cash={cash}
        setCash={setCash}
        foreignCash={foreignCash}
        setForeignCash={setForeignCash}
        usdKrw={USD_KRW}
        stockValue={Object.entries(spotPositions).reduce((sum,[id,pos])=>{const asset=allAssets.find((item)=>item.id===id);return sum+(pos.type==="stocks"&&asset?spotPriceInKRW(asset)*pos.quantity:0);},0)}
        financeAccount={financeAccount}
        setFinanceAccount={setFinanceAccount}
        lendingUsed={lendingUsed}
      />
    )}
    {mainTab === "summary" && <MarketSummary stocks={markets.stocks} indices={marketIndices} onOpenAsset={openStockFromInfo} />}
    {mainTab === "operations" && <Operations />}
    </Suspense>
  );
}
