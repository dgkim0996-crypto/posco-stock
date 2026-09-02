import { instruments } from "../data/instruments.data.js";

const getAll = ({ market, type, q } = {}) => {
  const normalizedQuery = q?.trim().toLowerCase();
  return instruments.filter((instrument) => {
    if (market && instrument.market.toLowerCase() !== market.toLowerCase()) return false;
    if (type && instrument.type.toLowerCase() !== type.toLowerCase()) return false;
    if (normalizedQuery && !instrument.name.toLowerCase().includes(normalizedQuery)
      && !instrument.symbol.toLowerCase().includes(normalizedQuery)) return false;
    return true;
  });
};

const getBySymbol = (symbol) => instruments.find(
  (instrument) => instrument.symbol.toLowerCase() === symbol.toLowerCase(),
) || null;

export default { getAll, getBySymbol };
