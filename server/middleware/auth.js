import { getSupabaseAdmin } from "../lib/supabase.js";

// expose=true인 5xx 안내문은 내부 원인을 포함하지 않으므로 errorHandler가 그대로 응답한다.
const httpError = (status, message, cause, expose = false) => Object.assign(new Error(message), { status, cause, expose });
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
// 클라이언트가 조작할 수 없는 요청 내부 표식으로 같은 요청의 인증 완료 여부를 기록한다.
const AUTHENTICATED = Symbol("requireAccount.authenticated");

// 네트워크 단절(status 0)·응답 없음·5xx는 세션 문제가 아니라 Supabase Auth 일시 장애다.
const isAuthServiceUnavailable = (error) => {
  const status = Number(error?.status);
  return error?.name === "AuthRetryableFetchError" || !Number.isInteger(status) || status <= 0 || status >= 500;
};

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
  // /api/accounts 요청이 여러 계좌 라우터를 지나도 토큰 확인과 계좌 준비는 요청당 한 번만 수행한다.
  if (req[AUTHENTICATED]) return next();
  try {
    const authorization = req.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) throw httpError(401, "로그인이 필요합니다.");

    const { data, error } = await getSupabaseAdmin().auth.getUser(match[1]);
    if (error && isAuthServiceUnavailable(error)) {
      throw httpError(503, "로그인 확인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", error, true);
    }
    if (error || !data?.user) throw httpError(401, "로그인 세션이 만료되었거나 올바르지 않습니다.", error);

    const { data: account, error: provisionError } = await provisionAccount(data.user);
    if (provisionError) throw httpError(503, "사용자 계좌를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.", provisionError, true);

    req.authUser = data.user;
    req.accountId = Number(account.id);
    req.account = account;
    req[AUTHENTICATED] = true;
    next();
  } catch (error) {
    next(error);
  }
}
