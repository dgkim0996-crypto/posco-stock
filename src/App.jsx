import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase.js";
import PasswordRecovery from "./components/PasswordRecovery.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import TradingApp from "./app/TradingApp.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(() => new URLSearchParams(window.location.search).has("password-recovery"));

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) { setSession(data.session); setAuthReady(true); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  if (!authReady) return <main className="auth-page"><div className="auth-loading">로그인 상태를 확인하고 있습니다...</div></main>;
  if (passwordRecovery && session) return <PasswordRecovery onDone={() => setPasswordRecovery(false)} />;
  if (!session) return <AuthScreen />;
  return <TradingApp session={session} onSignOut={() => supabase.auth.signOut()} />;
}
