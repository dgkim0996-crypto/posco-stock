import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { supabaseConfigurationError } from "./lib/supabase.js";

// 브라우저 진입점. #root에 최상위 App을 연결하며 StrictMode로 개발 중 부작용을 검사한다.

function ConfigurationError() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f4f7fb" }}>
      <section style={{ width: "min(560px, 100%)", padding: 32, borderRadius: 16, background: "white", boxShadow: "0 16px 45px rgba(16, 42, 67, .12)" }}>
        <strong style={{ color: "#005891" }}>POSCO SECURITIES · 배포 설정</strong>
        <h1 style={{ margin: "12px 0", fontSize: 26 }}>서비스 연결 정보가 필요합니다.</h1>
        <p style={{ margin: 0, lineHeight: 1.7, color: "#4b6075" }}>
          Vercel 프로젝트의 Environment Variables에 <code>VITE_SUPABASE_URL</code>과{" "}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>를 등록한 다음 다시 배포해 주세요.
        </p>
        <p style={{ margin: "16px 0 0", fontSize: 13, color: "#7c8b99" }}>{supabaseConfigurationError}</p>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {supabaseConfigurationError ? <ConfigurationError /> : <App />}
  </React.StrictMode>,
);
