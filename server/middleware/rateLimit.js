// 외부 API처럼 비용·부하가 큰 경로를 프로세스 단위에서 제한한다.
// 여러 서버 인스턴스로 배포할 경우에는 Redis 등 공유 저장소 기반 제한기로 교체한다.
export function createRateLimit({ windowMs, max, key = (req) => req.ip || "unknown", message }) {
  const requests = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const requestKey = String(key(req));
    const current = requests.get(requestKey);
    const startedAt = current && now - current.startedAt < windowMs ? current.startedAt : now;
    const count = current && startedAt === current.startedAt ? current.count + 1 : 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((startedAt + windowMs - now) / 1000));

    if (count > max) {
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: message || "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", retryAfter: retryAfterSeconds });
    }

    requests.set(requestKey, { startedAt, count });
    // Map이 무한히 커지지 않도록 만료된 키를 정리한다.
    if (requests.size > 1_000) {
      for (const [storedKey, value] of requests) {
        if (now - value.startedAt >= windowMs) requests.delete(storedKey);
      }
    }
    return next();
  };
}
