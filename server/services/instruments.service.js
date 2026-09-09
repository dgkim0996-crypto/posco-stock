import { instruments } from "../data/instruments.data.js";

// 종목 원본 목록을 시장·상품유형·검색어로 조회하는 읽기 전용 서비스다.

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

// 종목코드는 대소문자를 구분하지 않고 하나를 찾는다.
const getBySymbol = (symbol) => instruments.find(
  (instrument) => instrument.symbol.toLowerCase() === symbol.toLowerCase(),
) || null;

export default { getAll, getBySymbol };
