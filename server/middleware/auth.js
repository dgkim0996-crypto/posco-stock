import { getSupabaseAdmin } from "../lib/supabase.js";

const httpError = (status, message, cause) => Object.assign(new Error(message), { status, cause });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function provisionAccount(user) {
  let lastResult;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await wait(1200);
    lastResult = await getSupabaseAdmin().rpc("provision_user_account", {
      p_user_id: user.id,
      p_email: user.email || null,
    });
    if (!lastResult.error || !lastResult.error.message?.includes("JWT issued at future")) return lastResult;
  }
  return lastResult;
}

export async function requireAccount(req, _res, next) {
  try {
    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) throw httpError(401, "로그인이 필요합니다.");

    const { data, error } = await getSupabaseAdmin().auth.getUser(match[1]);
    if (error || !data.user) {
      const authStatus = Number(error?.status);
      if (!Number.isInteger(authStatus) || authStatus >= 500) {
        throw httpError(503, "Supabase 로그인 확인 서버에 연결하지 못했습니다.", error);
      }
      throw httpError(401, "로그인 세션이 만료되었거나 올바르지 않습니다.", error);
    }

    const { data: account, error: provisionError } = await provisionAccount(data.user);
    if (provisionError) throw httpError(503, `사용자 계좌 준비 실패: ${provisionError.message}`, provisionError);

    req.authUser = data.user;
    req.accountId = Number(account.id);
    req.account = account;
    next();
  } catch (error) {
    next(error);
  }
}
