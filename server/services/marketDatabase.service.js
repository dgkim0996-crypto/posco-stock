import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CACHE_DIRECTORY = path.resolve(".cache");
const DATABASE_PATH = path.join(CACHE_DIRECTORY, "market-data.sqlite");

// DB 파일을 만들기 전에 저장 폴더가 존재하도록 보장한다.
mkdirSync(CACHE_DIRECTORY, { recursive: true });

const database = new DatabaseSync(DATABASE_PATH);
// WAL은 읽기와 쓰기의 충돌을 줄이고, NORMAL은 안정성과 쓰기 속도의 균형을 맞춘다.
// 현재가, 차트 갱신 시각, 개별 OHLCV 봉은 용도에 맞게 별도 테이블에 저장한다.
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS market_quotes (
    symbol TEXT PRIMARY KEY,
    price REAL NOT NULL,
    change_amount REAL,
    change_rate REAL,
    open REAL,
    high REAL,
    low REAL,
    volume REAL,
    source TEXT,
    is_real INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chart_metadata (
    symbol TEXT NOT NULL,
    period TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (symbol, period)
  );

  CREATE TABLE IF NOT EXISTS chart_candles (
    symbol TEXT NOT NULL,
    period TEXT NOT NULL,
    time TEXT NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (symbol, period, time)
  );

  CREATE INDEX IF NOT EXISTS idx_chart_candles_lookup
  ON chart_candles (symbol, period, time);
`);

const upsertQuoteStatement = database.prepare(`
  INSERT INTO market_quotes (
    symbol, price, change_amount, change_rate, open, high, low, volume, source, is_real, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(symbol) DO UPDATE SET
    price = excluded.price,
    change_amount = excluded.change_amount,
    change_rate = excluded.change_rate,
    open = excluded.open,
    high = excluded.high,
    low = excluded.low,
    volume = excluded.volume,
    source = excluded.source,
    is_real = excluded.is_real,
    updated_at = excluded.updated_at
`);

// 같은 종목이 이미 있으면 행을 추가하지 않고 마지막 정상 시세로 갱신한다.
const saveQuote = (quote) => {
  upsertQuoteStatement.run(
    quote.symbol, quote.price, quote.changeAmount, quote.change,
    quote.open, quote.high, quote.low, quote.volume, quote.source,
    quote.isReal === false ? 0 : 1, quote.updatedAt || new Date().toISOString(),
  );
};

// 서버 시작 시 DB 시세를 애플리케이션에서 사용하는 객체 형태로 복원한다.
const loadQuotes = () => database.prepare(`
  SELECT symbol, price, change_amount, change_rate, open, high, low, volume, source, is_real, updated_at
  FROM market_quotes
`).all().map((row) => ({
  symbol: row.symbol,
  price: row.price,
  changeAmount: row.change_amount,
  change: row.change_rate,
  open: row.open,
  high: row.high,
  low: row.low,
  volume: row.volume,
  source: row.source,
  isReal: Boolean(row.is_real),
  updatedAt: row.updated_at,
}));

// 차트 전체를 빠르게 교체하기 위해 반복 사용하는 SQL 문을 미리 준비한다.
const deleteChartStatement = database.prepare("DELETE FROM chart_candles WHERE symbol = ? AND period = ?");
const insertCandleStatement = database.prepare(`
  INSERT INTO chart_candles (symbol, period, time, open, high, low, close, volume)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const upsertMetadataStatement = database.prepare(`
  INSERT INTO chart_metadata (symbol, period, saved_at, expires_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(symbol, period) DO UPDATE SET saved_at = excluded.saved_at, expires_at = excluded.expires_at
`);

// 삭제·봉 삽입·메타데이터 갱신을 한 트랜잭션으로 묶어 불완전한 차트 저장을 방지한다.
const saveChart = (symbol, period, entry) => {
  database.exec("BEGIN IMMEDIATE");
  try {
    deleteChartStatement.run(symbol, period);
    for (const item of entry.items) {
      insertCandleStatement.run(symbol, period, item.time, item.open, item.high, item.low, item.close, item.volume ?? 0);
    }
    upsertMetadataStatement.run(symbol, period, entry.savedAt, entry.expiresAt);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

// DB 차트를 `기간:종목코드` 키의 Map으로 만들어 API가 디스크를 반복 조회하지 않게 한다.
const loadCharts = () => {
  const entries = new Map();
  const metadata = database.prepare("SELECT symbol, period, saved_at, expires_at FROM chart_metadata").all();
  const candleStatement = database.prepare(`
    SELECT time, open, high, low, close, volume FROM chart_candles
    WHERE symbol = ? AND period = ? ORDER BY time ASC
  `);
  for (const row of metadata) {
    const items = candleStatement.all(row.symbol, row.period);
    if (items.length) entries.set(`${row.period}:${row.symbol}`, {
      items,
      savedAt: row.saved_at,
      expiresAt: Number(row.expires_at),
    });
  }
  return entries;
};

const getStatus = () => {
  const quoteStats = database.prepare(`
    SELECT COUNT(*) AS count, MAX(updated_at) AS last_updated_at FROM market_quotes
  `).get();
  const chartStats = database.prepare(`
    SELECT COUNT(*) AS count, MAX(saved_at) AS last_updated_at FROM chart_metadata
  `).get();
  database.prepare("SELECT 1 AS ok").get();
  return {
    connected: true,
    quoteCount: Number(quoteStats.count),
    chartCount: Number(chartStats.count),
    lastQuoteAt: quoteStats.last_updated_at,
    lastChartAt: chartStats.last_updated_at,
  };
};

// 이전 JSON 캐시 사용자가 데이터를 잃지 않도록 SQLite가 비어 있을 때만 최초 이관한다.
const migrateJsonCaches = () => {
  if (loadQuotes().length === 0) {
    const quotePath = path.join(CACHE_DIRECTORY, "market-quotes.json");
    if (existsSync(quotePath)) {
      try {
        const saved = JSON.parse(readFileSync(quotePath, "utf8"));
        for (const quote of Array.isArray(saved.items) ? saved.items : []) saveQuote(quote);
      } catch (error) {
        console.warn("기존 시세 JSON 캐시 이관 실패:", error.message);
      }
    }
  }

  if (database.prepare("SELECT COUNT(*) AS count FROM chart_metadata").get().count === 0) {
    const chartPath = path.join(CACHE_DIRECTORY, "market-charts.json");
    if (existsSync(chartPath)) {
      try {
        const saved = JSON.parse(readFileSync(chartPath, "utf8"));
        for (const [key, entry] of Object.entries(saved.entries || {})) {
          const separator = key.indexOf(":");
          if (separator > 0 && Array.isArray(entry?.items) && entry.items.length) {
            saveChart(key.slice(separator + 1), key.slice(0, separator), entry);
          }
        }
      } catch (error) {
        console.warn("기존 차트 JSON 캐시 이관 실패:", error.message);
      }
    }
  }
};

// 이 모듈이 처음 로드될 때 한 번만 이전 데이터의 이관 여부를 확인한다.
migrateJsonCaches();

export default { getStatus, loadQuotes, saveQuote, loadCharts, saveChart, databasePath: DATABASE_PATH };
