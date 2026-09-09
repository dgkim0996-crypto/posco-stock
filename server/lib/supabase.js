import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const enabled = process.env.SUPABASE_ENABLED === "true";
const url = process.env.SUPABASE_URL?.trim();
// 최신 프로젝트의 Secret key를 우선 사용하고 기존 service_role 키도 호환한다.
const serverKey = process.env.SUPABASE_SECRET_KEY?.trim()
  || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

let client = null;

if (enabled) {
  if (!url || !serverKey) {
    throw new Error(
      "SUPABASE_ENABLED=true이지만 SUPABASE_URL 또는 서버용 Secret key가 없습니다.",
    );
  }

  client = createClient(url, serverKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export const isSupabaseEnabled = () => enabled;

export const getSupabaseAdmin = () => {
  if (!client) {
    throw new Error("Supabase가 비활성화되어 있습니다. SUPABASE_ENABLED=true를 설정하세요.");
  }
  return client;
};
