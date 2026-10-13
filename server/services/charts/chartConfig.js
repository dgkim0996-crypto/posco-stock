export const EXCHANGE_CODES = { NASDAQ: "NAS", NYSE: "NYS", AMEX: "AMS" };
export const MINUTE_PERIODS = new Map([["1m", 1], ["5m", 5], ["30m", 30], ["60m", 60]]);
export const VALID_PERIODS = new Set([...MINUTE_PERIODS.keys(), "day"]);

export const createError = (status, message) => Object.assign(new Error(message), { status });
