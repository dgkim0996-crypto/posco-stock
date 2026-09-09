// 영문 시장코드와 사용자가 자주 입력하는 한글 명칭을 같은 검색어로 취급한다.
const MARKET_ALIASES = {
  KOSPI: ["kospi", "코스피", "유가증권"],
  KOSDAQ: ["kosdaq", "코스닥"],
  NASDAQ: ["nasdaq", "나스닥"],
  NYSE: ["nyse", "뉴욕증권거래소", "뉴욕증시"],
  AMEX: ["amex", "아멕스", "미국증권거래소"],
};

// 공백과 하이픈, 영문 대소문자 차이를 제거해 입력 방식이 달라도 비교할 수 있게 한다.
export function normalizeAssetSearchText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s-]/g, "");
}

// 종목명·코드·시장·상품 그룹·통화와 시장의 한글 별칭을 모두 검색한다.
export function assetMatchesSearch(asset, keyword) {
  const query = normalizeAssetSearchText(keyword);
  if (!query) return true;

  const aliases = MARKET_ALIASES[String(asset.market || "").toUpperCase()] || [];
  const fields = [asset.name, asset.symbol, asset.market, asset.group, asset.unit, ...aliases]
    .map(normalizeAssetSearchText);
  if (fields.some((field) => field.includes(query))) return true;

  // 사용자가 처음부터 0 없이 입력한 경우에만 코드 앞자리 0 생략 검색을 허용한다.
  // `005`처럼 0으로 시작한 검색어는 원문 그대로만 비교해 058430 같은 오검색을 막는다.
  if (/^\d+$/.test(query) && !query.startsWith("0")) {
    const numericQuery = query.replace(/^0+/, "") || "0";
    const numericSymbol = normalizeAssetSearchText(asset.symbol).replace(/^0+/, "") || "0";
    return /^\d+$/.test(normalizeAssetSearchText(asset.symbol)) && numericSymbol.includes(numericQuery);
  }

  return false;
}
