// Isolated UI fixture. No credentials, real account requests, or external writes.
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const server = await createServer({
  configFile: false,
  envFile: false,
  plugins: [react(), {
    name: "isolated-brokerage-fixtures", enforce: "pre",
    transform(code, id) {
      if (/\/src\/(lib\/supabase|utils\/api)\.js$/.test(id.replaceAll("\\", "/"))) {
        return 'export * from "/scripts/fixtures/brokerage-ui.js";';
      }
    },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        if (!req.url.startsWith("/api/")) return next();
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ items: [], candles: [], connected: false, error: "격리된 UI 테스트: 외부 시세 미연결" }));
      });
    },
  }],
  server: { host: "127.0.0.1", port: 4175, strictPort: true },
});
await server.listen();
console.log("Isolated brokerage UI fixture: http://127.0.0.1:4175 (no real accounts)");
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => { await server.close(); process.exit(0); });
