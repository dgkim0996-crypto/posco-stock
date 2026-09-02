let requestQueue = Promise.resolve();
let lastRequestAt = 0;

const getMinInterval = () => Math.max(
  550,
  Number(process.env.KIS_REQUEST_INTERVAL_MS) || (process.env.KIS_ENV === "paper" ? 1_100 : 650),
);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const enqueue = (task) => {
  const run = async () => {
    const remaining = getMinInterval() - (Date.now() - lastRequestAt);
    if (remaining > 0) await wait(remaining);
    lastRequestAt = Date.now();
    return task();
  };
  const result = requestQueue.then(run, run);
  requestQueue = result.catch(() => undefined);
  return result;
};

const isRateLimitResponse = (data) => /초당 거래건수|rate.?limit|too many/i.test(
  `${data?.msg1 || ""} ${data?.error_description || ""}`,
);

const fetchWithLimit = async (url, options, retryCount = 1) => {
  const response = await enqueue(() => fetch(url, options));
  if (retryCount <= 0) return response;

  const cloned = response.clone();
  const data = await cloned.json().catch(() => ({}));
  if (!isRateLimitResponse(data)) return response;

  await wait(1_100);
  return fetchWithLimit(url, options, retryCount - 1);
};

const createApiError = (data, response, fallback) => {
  const error = new Error(data?.msg1 || data?.error_description || fallback);
  if (isRateLimitResponse(data) || response?.status === 429) {
    error.status = 429;
    error.retryAfter = 2;
  }
  return error;
};

export default { fetchWithLimit, createApiError };
