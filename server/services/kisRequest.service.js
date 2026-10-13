let requestQueue = Promise.resolve();
let lastRequestAt = 0;
let queuedRequests = 0;

// 모든 KIS HTTP 요청을 한 큐에 넣어 초당 호출 제한을 넘지 않게 하는 서비스다.

const getMinInterval = () => Math.max(
  550,
  Number(process.env.KIS_REQUEST_INTERVAL_MS) || (process.env.KIS_ENV === "paper" ? 1_100 : 650),
);
// 응답이 없는 요청 하나가 직렬 큐 전체를 멈추지 않도록 요청마다 제한시간을 둔다.
const getRequestTimeout = () => Number(process.env.KIS_REQUEST_TIMEOUT_MS) || 10_000;
// 대기열이 길어지면 새 요청은 기다리게 하지 않고 즉시 재시도 안내를 반환한다.
const getMaxQueueLength = () => Number(process.env.KIS_REQUEST_QUEUE_MAX) || 20;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const createQueueFullError = () => {
  const error = new Error("KIS 요청 대기열이 가득 찼습니다.");
  error.status = 503;
  error.retryAfter = Math.max(1, Math.ceil((queuedRequests * getMinInterval()) / 1000));
  return error;
};

// 앞선 요청이 끝난 뒤 최소 간격만큼 기다렸다가 다음 요청을 실행한다.
const enqueue = (task) => {
  if (queuedRequests >= getMaxQueueLength()) return Promise.reject(createQueueFullError());
  queuedRequests += 1;
  const run = async () => {
    try {
      const remaining = getMinInterval() - (Date.now() - lastRequestAt);
      if (remaining > 0) await wait(remaining);
      lastRequestAt = Date.now();
      return await task();
    } finally {
      queuedRequests -= 1;
    }
  };
  const result = requestQueue.then(run, run);
  requestQueue = result.catch(() => undefined);
  return result;
};

// 제한시간은 대기열을 기다린 시간이 아니라 실제 KIS 호출이 시작된 시점부터 계산한다.
const fetchWithTimeout = async (url, options = {}) => {
  const timeout = AbortSignal.timeout(getRequestTimeout());
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...options, signal });
  } catch (error) {
    if (!timeout.aborted) throw error;
    throw Object.assign(new Error("KIS 응답 시간이 초과되었습니다."), { status: 504, cause: error });
  }
};

const isRateLimitResponse = (data) => /초당 거래건수|rate.?limit|too many/i.test(
  `${data?.msg1 || ""} ${data?.error_description || ""}`,
);

// 제한 응답을 받으면 잠시 대기한 뒤 정해진 횟수만큼 자동 재시도한다.
const fetchWithLimit = async (url, options, retryCount = 1) => {
  const response = await enqueue(() => fetchWithTimeout(url, options));
  if (retryCount <= 0) return response;

  const cloned = response.clone();
  const data = await cloned.json().catch(() => ({}));
  if (!isRateLimitResponse(data)) return response;

  await wait(1_100);
  return fetchWithLimit(url, options, retryCount - 1);
};

// KIS 오류 형식을 Express 오류 형식(status/retryAfter)으로 변환한다.
const createApiError = (data, response, fallback) => {
  const error = new Error(data?.msg1 || data?.error_description || fallback);
  if (isRateLimitResponse(data) || response?.status === 429) {
    error.status = 429;
    error.retryAfter = 2;
  }
  return error;
};

export default { fetchWithLimit, createApiError };
