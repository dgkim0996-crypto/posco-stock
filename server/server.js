import app from "./app.js";
import dotenv from "dotenv";
import marketDataService from "./services/marketData.service.js";

dotenv.config();

const PORT = process.env.PORT || 3001;

const startServer = () => {
  app.listen(PORT, () => {
    console.log("----------------------------------------");
    console.log("포스코증권 API 서버가 실행되었습니다.");
    console.log(`http://localhost:${PORT}`);
    console.log("----------------------------------------");
    try {
      marketDataService.startPolling();
      console.log("KIS 국내주식 REST 시세 수집을 시작합니다.");
    } catch (error) {
      console.error("KIS 시세 수집 시작 실패:", error.message);
    }
  });
};

startServer();
