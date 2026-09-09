import React, { useState } from "react";
import { supabase } from "../lib/supabase.js";
import poscoLogo from "../assets/posco-ci-blue.png";

export default function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim()) return setMessage("이메일을 입력해 주세요.");
    if (mode !== "reset" && password.length < 8) return setMessage("비밀번호는 8자 이상 입력해 주세요.");
    setLoading(true);
    setMessage("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setMessage(data.session ? "회원가입과 로그인이 완료되었습니다." : "인증 메일을 보냈습니다. 이메일의 확인 링크를 눌러주세요.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/?password-recovery=1`,
        });
        if (error) throw error;
        setMessage("비밀번호 재설정 메일을 보냈습니다.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (error) {
      setMessage(error.message || "인증 처리에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <img src={poscoLogo} alt="POSCO" />
        <span>POSCO SECURITIES · SIMULATION</span>
        <h1>{mode === "signup" ? "모의투자 계정 만들기" : mode === "reset" ? "비밀번호 재설정" : "모의투자 로그인"}</h1>
        <p>{mode === "signup" ? "가입한 계정마다 별도의 모의계좌가 생성됩니다." : "Supabase 이메일 계정으로 안전하게 접속합니다."}</p>
        <form onSubmit={submit}>
          <label>이메일<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          {mode !== "reset" && <label>비밀번호<input type="password" minLength="8" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
          <button type="submit" disabled={loading}>{loading ? "처리 중..." : mode === "signup" ? "회원가입" : mode === "reset" ? "재설정 메일 보내기" : "로그인"}</button>
        </form>
        {message && <div className="auth-message" role="status">{message}</div>}
        <div className="auth-links">
          {mode !== "login" && <button type="button" onClick={() => { setMode("login"); setMessage(""); }}>로그인</button>}
          {mode !== "signup" && <button type="button" onClick={() => { setMode("signup"); setMessage(""); }}>회원가입</button>}
          {mode !== "reset" && <button type="button" onClick={() => { setMode("reset"); setMessage(""); }}>비밀번호 찾기</button>}
        </div>
      </section>
    </main>
  );
}
