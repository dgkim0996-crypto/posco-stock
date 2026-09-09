import React, { useEffect, useState } from "react";
import { apiFetch } from "../utils/api.js";

const LABELS = {
  accountDatabase: "계좌 데이터베이스",
  marketCache: "시세 SQLite 캐시",
  marketRest: "KIS REST 수집",
  marketRealtime: "KIS 실시간 연결",
  http: "HTTP 요청",
};

const STATUS_LABELS = { ok: "정상", degraded: "저하", down: "중단", idle: "대기" };
const time = (value) => value ? new Date(value).toLocaleString("ko-KR") : "기록 없음";

export default function Operations() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(true);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const response = await apiFetch("/api/operations/status");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "운영 상태를 확인하지 못했습니다.");
      setData(payload);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="operations-page">
      <section className="operations-heading">
        <div>
          <span>6단계 운영 안정화</span>
          <h1>서비스 운영 상태</h1>
          <p>데이터베이스와 시세 수집 상태를 10초마다 확인합니다.</p>
        </div>
        <div className={`operations-overall ${data?.status || "loading"}`}>
          <i />
          <span>{data ? STATUS_LABELS[data.status] : "확인 중"}</span>
          <strong>{data?.ready ? "서비스 준비 완료" : "서비스 점검 필요"}</strong>
        </div>
        <button type="button" onClick={refresh} disabled={refreshing}>{refreshing ? "확인 중" : "새로고침"}</button>
      </section>

      {error && <div className="operations-error">{error}</div>}
      {data && (
        <>
          <section className="operations-grid">
            {Object.entries(data.components).map(([key, item]) => (
              <article key={key} className={`operations-card ${item.status}`}>
                <header><div><span>{LABELS[key]}</span><strong>{STATUS_LABELS[item.status]}</strong></div><i /></header>
                {key === "accountDatabase" && <dl><div><dt>모드</dt><dd>{item.mode || "Supabase"}</dd></div><div><dt>연결</dt><dd>{item.connected ? "연결됨" : "연결 안 됨"}</dd></div></dl>}
                {key === "marketCache" && <dl><div><dt>저장 시세</dt><dd>{item.quoteCount?.toLocaleString()}종목</dd></div><div><dt>저장 차트</dt><dd>{item.chartCount?.toLocaleString()}개</dd></div><div><dt>최근 시세</dt><dd>{time(item.lastQuoteAt)}</dd></div></dl>}
                {key === "marketRest" && <dl><div><dt>수집기</dt><dd>{item.polling ? "실행 중" : "중지"}</dd></div><div><dt>최근 수신</dt><dd>{time(item.lastLiveUpdateAt)}</dd></div><div><dt>연속 실패</dt><dd>{item.consecutiveFailures}회</dd></div></dl>}
                {key === "marketRealtime" && <dl><div><dt>브라우저</dt><dd>{item.clientCount}개</dd></div><div><dt>구독 종목</dt><dd>{item.subscribedSymbols.length}개</dd></div><div><dt>재접속</dt><dd>{item.reconnectAttempts}회</dd></div></dl>}
                {key === "http" && <dl><div><dt>전체 요청</dt><dd>{item.totalRequests.toLocaleString()}건</dd></div><div><dt>오류율</dt><dd>{(item.errorRate * 100).toFixed(2)}%</dd></div><div><dt>평균 응답</dt><dd>{item.averageDurationMs}ms</dd></div></dl>}
                {item.lastError?.message && <p>{item.lastError.message}</p>}
              </article>
            ))}
          </section>
          <p className="operations-checked">마지막 점검 {time(data.checkedAt)}</p>
        </>
      )}
    </main>
  );
}
