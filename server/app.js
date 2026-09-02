import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import healthRouter from "./routes/health.routes.js";
import instrumentsRouter from "./routes/instruments.routes.js";
import accountsRouter from "./routes/accounts.routes.js";
import ordersRouter from "./routes/orders.routes.js";
import quotesRouter from "./routes/quotes.routes.js";
import chartsRouter from "./routes/charts.routes.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

dotenv.config();

const app = express();

// CORS Configuration
const allowedOrigin = process.env.CLIENT_URL || "http://localhost:5173";
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

// Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routing
app.use("/api", healthRouter);
app.use("/api", instrumentsRouter);
app.use("/api", accountsRouter);
app.use("/api", ordersRouter);
app.use("/api", quotesRouter);
app.use("/api", chartsRouter);

// Error Handling Middlewares
app.use(notFound);
app.use(errorHandler);

export default app;
