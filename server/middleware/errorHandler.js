export const errorHandler = (err, req, res, next) => {
  console.error("서버 에러 감지:", err);

  const status = err.status || 500;
  const message = status === 500 ? "서버 오류가 발생했습니다." : err.message;

  res.status(status).json({ error: message });
};
