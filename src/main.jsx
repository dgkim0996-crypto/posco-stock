import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

// 브라우저 진입점. #root에 최상위 App을 연결하며 StrictMode로 개발 중 부작용을 검사한다.

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
