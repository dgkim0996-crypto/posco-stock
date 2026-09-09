import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import healthRouter from "./routes/health.routes.js";
import instrumentsRouter from "./routes/instruments.routes.js";
import accountsRouter from "./routes/accounts.routes.js";
import ordersRouter from "./routes/orders.routes.js";
import quotesRouter from "./routes/quotes.routes.js";
import chartsRouter from "./routes/charts.routes.js";
import feedRouter from "./routes/feed.routes.js";
import indicesRouter from "./routes/indices.routes.js";
import alternativeQuotesRouter from "./routes/alternativeQuotes.routes.js";
import alternativeChartsRouter from "./routes/alternativeCharts.routes.js";
import advisorRouter from "./routes/advisor.routes.js";
import fundamentalsRouter from "./routes/fundamentals.routes.js";
import databaseRouter from "./routes/database.routes.js";
import favoritesRouter from "./routes/favorites.routes.js";
import financeRouter from "./routes/finance.routes.js";
import futuresRouter from "./routes/futures.routes.js";
import pendingOrdersRouter from "./routes/pendingOrders.routes.js";
import settlementsRouter from "./routes/settlements.routes.js";
import riskRouter from "./routes/risk.routes.js";
import stockImagesRouter from "./routes/stockImages.routes.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestMetrics } from "./middleware/requestMetrics.js";

// Express 앱 구성 파일. 요청은 CORS/본문 파싱 → 라우터 → 404 → 공통 오류 처리 순서로 흐른다.

dotenv.config();

const app = express();

// CLIENT_URL에서 온 브라우저 요청을 허용하며, 미설정 시 Vite 기본 주소를 사용한다.
const allowedOrigin = process.env.CLIENT_URL || "http://localhost:5173";
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  }),
);
// JSON 및 HTML form 형식의 요청 본문을 req.body로 변환한다.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestMetrics);

// 공개 시장 데이터 라우터를 인증 라우터보다 먼저 연결한다.
// 개별 인증 라우터의 router.use(requireAccount)가 다른 공개 경로까지 가로채지 않도록
// 공개 조회가 먼저 정확한 라우터에서 응답하게 한다.
app.use("/api", healthRouter);
app.use("/api", instrumentsRouter);
app.use("/api", quotesRouter);
app.use("/api", chartsRouter);
app.use("/api", feedRouter);
app.use("/api", indicesRouter);
app.use("/api", alternativeQuotesRouter);
app.use("/api", alternativeChartsRouter);
app.use("/api", advisorRouter);
app.use("/api", fundamentalsRouter);
app.use("/api", databaseRouter);
// 외부 종목 이미지는 브라우저에서 직접 요청하지 않고 동일 출처 프록시로 전달한다.
app.use("/api", stockImagesRouter);

// 계좌 소유권이 필요한 변경/조회 API는 공개 시장 데이터 뒤에서 인증한다.
app.use("/api", accountsRouter);
app.use("/api", ordersRouter);
app.use("/api", favoritesRouter);
app.use("/api", financeRouter);
app.use("/api", futuresRouter);
app.use("/api", pendingOrdersRouter);
app.use("/api", settlementsRouter);
app.use("/api", riskRouter);

// 어떤 라우터에도 매칭되지 않은 요청과 라우터에서 전달된 오류를 마지막에 처리한다.
app.use(notFound);
app.use(errorHandler);

export default app;
