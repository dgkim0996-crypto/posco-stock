// 모든 라우터의 마지막 오류 처리기. 내부 오류는 상세내용을 숨기고 재시도 정보만 안전하게 전달한다.
export const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const message = status === 500 ? "서버 오류가 발생했습니다." : err.message;
  if (status >= 500) console.error("서버 에러 감지:", err);
  else console.warn(`[${status}] ${req.method} ${req.originalUrl}: ${message}`);

  if (err.retryAfter) res.set("Retry-After", String(err.retryAfter));
  res.status(status).json({ error: message, retryAfter: err.retryAfter || undefined });
};
