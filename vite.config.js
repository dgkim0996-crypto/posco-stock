import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// 프론트 개발 서버 설정.
// React JSX 변환을 활성화하고 /api 요청은 Express 서버(3001)로 전달해 CORS 없이 같은 주소처럼 사용한다.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.PORT || "3001";
  return {
    plugins: [react()],
    server: {
      watch: { ignored: ["**/.pptx-work/**", "**/output/**"] },
      proxy: {
        "/api": {
          target: `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
        "/ws": {
          target: `ws://localhost:${apiPort}`,
          ws: true,
        },
      },
    },
  };
});
