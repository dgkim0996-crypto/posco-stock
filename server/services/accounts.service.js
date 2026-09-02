import { accounts } from "../data/accounts.data.js";
import { holdings } from "../data/holdings.data.js";
import instrumentsService from "./instruments.service.js";

const getById = (id) => accounts.find((account) => account.id === id) || null;

const getHoldings = (accountId) => {
  if (!getById(accountId)) return null;

  const items = holdings
    .filter((holding) => holding.accountId === accountId)
    .map((holding) => {
      const instrument = instrumentsService.getBySymbol(holding.symbol);
      const currentPrice = instrument?.price ?? 0;
      const marketValue = currentPrice * holding.quantity;
      const profitLoss = marketValue - holding.avgPrice * holding.quantity;
      return {
        ...holding,
        name: instrument?.name ?? holding.symbol,
        currentPrice,
        marketValue,
        profitLoss,
      };
    });

  return { items };
};

export default { getById, getHoldings };
