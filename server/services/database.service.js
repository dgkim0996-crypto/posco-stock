import { getSupabaseAdmin, isSupabaseEnabled } from "../lib/supabase.js";

const getStatus = async () => {
  if (!isSupabaseEnabled()) {
    return {
      configured: false,
      connected: false,
      mode: "memory",
      message: "Supabase가 비활성화되어 기존 메모리 데이터를 사용 중입니다.",
    };
  }

  let error = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    ({ error } = await getSupabaseAdmin()
      .from("accounts")
      .select("id", { count: "exact", head: true }));
    if (!error) break;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (error) {
    const connectionError = new Error(`Supabase 연결 점검 실패: ${error.message}`);
    connectionError.status = 503;
    connectionError.cause = error;
    throw connectionError;
  }

  return {
    configured: true,
    connected: true,
    mode: "supabase",
    message: "Supabase와 accounts 테이블에 정상적으로 연결되었습니다.",
  };
};

export default { getStatus };
