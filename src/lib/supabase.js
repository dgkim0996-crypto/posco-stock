import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigurationError = !url || !publishableKey
  ? "VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY가 필요합니다."
  : null;

// 배포 환경변수가 빠진 경우에도 모듈 로딩 단계에서 앱 전체를 중단하지 않는다.
// main.jsx가 설정 안내 화면을 렌더링하므로 Vercel의 빈 화면 원인을 바로 확인할 수 있다.
export const supabase = supabaseConfigurationError
  ? null
  : createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
