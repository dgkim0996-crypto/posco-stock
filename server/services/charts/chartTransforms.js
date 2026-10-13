export const numberValue = (...values) => {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
export const textValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== "") || "";

// 서로 다른 KIS 응답 필드를 숫자형 OHLCV 객체로 정규화하고 잘못된 봉은 제거한다.
export const candle = (time, open, high, low, close, volume) => {
  const closePrice = numberValue(close);
  if (!time || !Number.isFinite(closePrice) || closePrice <= 0) return null;
  const parsedOpen = numberValue(open);
  const parsedHigh = numberValue(high);
  const parsedLow = numberValue(low);
  const openPrice = parsedOpen > 0 ? parsedOpen : closePrice;
  const reportedHigh = parsedHigh > 0 ? parsedHigh : Math.max(openPrice, closePrice);
  const reportedLow = parsedLow > 0 ? parsedLow : Math.min(openPrice, closePrice);
  return {
    time,
    open: openPrice,
    high: Math.max(reportedHigh, openPrice, closePrice),
    low: Math.min(reportedLow, openPrice, closePrice),
    close: closePrice,
    volume: numberValue(volume) ?? 0,
  };
};

// 국내 일자/시각 문자열에 한국 시간대 오프셋을 붙여 ISO 시각으로 만든다.
export const parseKoreanDateTime = (date, time = "000000") => {
  if (!date || date.length < 8) return null;
  const normalizedTime = String(time).padStart(6, "0");
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${normalizedTime.slice(0, 2)}:${normalizedTime.slice(2, 4)}:${normalizedTime.slice(4, 6)}+09:00`;
};

// 해외 API의 일자/시각 문자열을 차트가 읽을 수 있는 ISO 형태로 만든다.
export const parseOverseasDateTime = (date, time = "000000") => {
  if (!date || date.length < 8) return null;
  const normalizedTime = String(time).padStart(6, "0");
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${normalizedTime.slice(0, 2)}:${normalizedTime.slice(2, 4)}:${normalizedTime.slice(4, 6)}`;
};

export const sortCandles = (items) => items.filter(Boolean).sort((a, b) => new Date(a.time) - new Date(b.time));

// 여러 1분봉을 N분봉으로 묶어 시가·고가·저가·종가·거래량을 다시 계산한다.
export const aggregateMinutes = (items, size) => {
  const groups = new Map();
  for (const item of items) {
    const date = new Date(item.time);
    date.setMinutes(Math.floor(date.getMinutes() / size) * size, 0, 0);
    const key = date.toISOString();
    const current = groups.get(key);
    if (!current) groups.set(key, { ...item, time: key });
    else groups.set(key, {
      ...current,
      high: Math.max(current.high, item.high),
      low: Math.min(current.low, item.low),
      close: item.close,
      volume: current.volume + item.volume,
    });
  }
  return [...groups.values()];
};

// 분봉이 완전히 비어 있을 때 최근 일봉 종가를 장 시작·종료 두 지점으로 만들어 차트를 즉시 표시한다.
export const previousCloseCandles = (days) => {
  const latest = days.at(-1);
  if (!latest || !Number.isFinite(latest.close)) return [];
  const date = String(latest.time).slice(0, 10);
  return ["09:00:00", "15:30:00"].map((time) => ({
    time: `${date}T${time}+09:00`,
    open: latest.close,
    high: latest.close,
    low: latest.close,
    close: latest.close,
    volume: 0,
  }));
};

// 장중 분봉 수가 부족하면 실제 최근 영업일 종가를 앞쪽에 붙여 최대 60개 탐색 범위를 보장한다.
export const padWithDailyCloses = (items, days, limit = 60) => {
  if (items.length >= limit) return items.slice(-limit);
  const occupiedDates = new Set(items.map((item) => String(item.time).slice(0, 10)));
  const closeHistory = days
    .filter((day) => Number.isFinite(day.close) && !occupiedDates.has(String(day.time).slice(0, 10)))
    .map((day) => {
      const date = String(day.time).slice(0, 10);
      return {
        time: `${date}T15:30:00+09:00`,
        open: day.close,
        high: day.close,
        low: day.close,
        close: day.close,
        volume: 0,
      };
    });
  return sortCandles([...closeHistory, ...items]).slice(-limit);
};
