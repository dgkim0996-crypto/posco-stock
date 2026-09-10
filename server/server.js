import app from "./app.js";
import dotenv from "dotenv";
import marketDataService from "./services/marketData.service.js";
import kisWebSocketService from "./services/kisWebSocket.service.js";

// 서버 실행 진입점.
// 1) Express 앱을 포트에 연결하고 2) 연결 완료 후 KIS 시세 순환 수집을 시작한다.

dotenv.config();

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";

const startServer = () => {
  const server = app.listen(PORT, HOST, () => {
    console.log("----------------------------------------");
    console.log("포스코증권 API 서버가 실행되었습니다.");
    console.log(`http://${HOST}:${PORT}`);
    console.log("----------------------------------------");
    try {
      marketDataService.startPolling();
      console.log("KIS 국내주식 REST 시세 수집을 시작합니다.");
    } catch (error) {
      console.error("KIS 시세 수집 시작 실패:", error.message);
    }
  });
  kisWebSocketService.attach(server);
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} 수신: 신규 연결을 중단하고 서버를 안전하게 종료합니다.`);
    kisWebSocketService.stop();
    marketDataService.stopPolling();
    const forceExitTimer = setTimeout(() => {
      console.error("정상 종료 제한시간을 초과해 프로세스를 종료합니다.");
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();
    server.close((error) => {
      clearTimeout(forceExitTimer);
      if (error) {
        console.error("HTTP 서버 종료 실패:", error.message);
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

startServer();
