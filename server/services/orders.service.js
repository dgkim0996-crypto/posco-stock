import { accounts } from "../data/accounts.data.js";
import { holdings } from "../data/holdings.data.js";
import { orders } from "../data/orders.data.js";
import instrumentsService from "./instruments.service.js";

const createError = (status, message) => Object.assign(new Error(message), { status });

const validateOrder = ({ accountId, symbol, side, quantity }) => {
  const parsedAccountId = Number(accountId);
  const parsedQuantity = Number(quantity);
  if (!Number.isInteger(parsedAccountId) || parsedAccountId <= 0) throw createError(400, "잘못된 accountId입니다.");
  if (typeof symbol !== "string" || !symbol.trim()) throw createError(400, "symbol이 필요합니다.");
  if (!['BUY', 'SELL'].includes(side)) throw createError(400, "side는 BUY 또는 SELL이어야 합니다.");
  if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) throw createError(400, "quantity는 0보다 큰 숫자여야 합니다.");
  return { accountId: parsedAccountId, symbol: symbol.trim(), side, quantity: parsedQuantity };
};

const createOrder = (payload) => {
  const input = validateOrder(payload);
  const account = accounts.find((item) => item.id === input.accountId);
  if (!account) throw createError(404, "계좌를 찾을 수 없습니다.");

  const instrument = instrumentsService.getBySymbol(input.symbol);
  if (!instrument) throw createError(404, "종목을 찾을 수 없습니다.");

  const balanceKey = instrument.currency === "USD" ? "usdBalance" : "krwBalance";
  const totalAmount = instrument.price * input.quantity;
  const holdingIndex = holdings.findIndex(
    (item) => item.accountId === account.id && item.symbol === instrument.symbol,
  );
  const holding = holdings[holdingIndex];

  if (input.side === "BUY") {
    if (account[balanceKey] < totalAmount) throw createError(400, "잔고가 부족합니다.");
    account[balanceKey] -= totalAmount;
    if (holding) {
      holding.avgPrice = ((holding.quantity * holding.avgPrice) + totalAmount)
        / (holding.quantity + input.quantity);
      holding.quantity += input.quantity;
    } else {
      holdings.push({
        id: (holdings.reduce((max, item) => Math.max(max, item.id), 0) + 1),
        accountId: account.id,
        symbol: instrument.symbol,
        quantity: input.quantity,
        avgPrice: instrument.price,
      });
    }
  } else {
    if (!holding || holding.quantity < input.quantity) throw createError(400, "보유수량이 부족합니다.");
    holding.quantity -= input.quantity;
    account[balanceKey] += totalAmount;
    if (holding.quantity === 0) holdings.splice(holdingIndex, 1);
  }

  const order = {
    id: orders.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    accountId: account.id,
    symbol: instrument.symbol,
    side: input.side,
    quantity: input.quantity,
    price: instrument.price,
    totalAmount,
    status: "FILLED",
    createdAt: new Date().toISOString(),
  };
  orders.push(order);
  return { order, account, holding: holdings.find((item) => item.accountId === account.id && item.symbol === instrument.symbol) || null };
};

const getAll = (accountId) => {
  let result = [...orders];
  if (accountId !== undefined) {
    const parsedAccountId = Number(accountId);
    if (!Number.isInteger(parsedAccountId) || parsedAccountId <= 0) throw createError(400, "잘못된 accountId입니다.");
    result = result.filter((order) => order.accountId === parsedAccountId);
  }
  return result.sort((a, b) => b.id - a.id);
};

export default { createOrder, getAll };
