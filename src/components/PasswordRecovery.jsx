import React, { useState } from "react";
import { supabase } from "../lib/supabase.js";

export default function PasswordRecovery({ onDone }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 8) return setMessage("새 비밀번호는 8자 이상 입력해 주세요.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setMessage(error.message);
    window.history.replaceState({}, "", window.location.pathname);
    setMessage("비밀번호를 변경했습니다.");
    onDone();
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <span>ACCOUNT SECURITY</span><h1>새 비밀번호 설정</h1><p>앞으로 사용할 비밀번호를 입력해 주세요.</p>
        <form onSubmit={submit}><label>새 비밀번호<input type="password" minLength="8" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><button type="submit" disabled={loading}>{loading ? "변경 중..." : "비밀번호 변경"}</button></form>
        {message && <div className="auth-message" role="status">{message}</div>}
      </section>
    </main>
  );
}
