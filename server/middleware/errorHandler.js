// 5xx 원문에는 DB·외부 API의 내부 정보가 섞일 수 있으므로 상태별 일반 안내만 응답한다.
// 원인을 포함하지 않는 고정 안내문은 오류에 expose=true를 지정해 그대로 전달할 수 있다.
const SERVER_ERROR_MESSAGES = {
  500: "서버 오류가 발생했습니다.",
  502: "외부 데이터 서버의 응답을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  503: "서비스를 일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  504: "외부 서버의 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
};

const statusOf = (err) => {
  const status = Number(err?.status ?? err?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
};

// 모든 라우터의 마지막 오류 처리기. 내부 오류는 로그에만 남기고 재시도 정보만 안전하게 전달한다.
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = statusOf(err);
  const path = req.originalUrl.split("?", 1)[0];
  let message;
  if (status >= 500) {
    message = err?.expose === true && err.message ? err.message : SERVER_ERROR_MESSAGES[status] || SERVER_ERROR_MESSAGES[500];
    console.error(`[${status}] ${req.method} ${path}:`, err);
  } else {
    message = err?.message || "요청을 처리할 수 없습니다.";
    console.warn(`[${status}] ${req.method} ${path}: ${message}`);
  }

  const retryAfter = Number(err?.retryAfter);
  if (Number.isFinite(retryAfter) && retryAfter > 0) res.set("Retry-After", String(Math.ceil(retryAfter)));
  return res.status(status).json({ error: message, retryAfter: retryAfter > 0 ? Math.ceil(retryAfter) : undefined });
};
