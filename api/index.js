import app from "../server/app.js";

/**
 * Vercel의 단일 Node.js Function에서 기존 Express API를 실행한다.
 * vercel.json이 /api/*의 나머지 경로를 path 쿼리로 전달하므로 Express가
 * 로컬 서버와 동일한 URL을 받도록 요청 경로를 복원한다.
 */
export default function handler(request, response) {
  const requestUrl = new URL(request.url, "http://localhost");
  const rawPath = request.query?.path ?? requestUrl.searchParams.get("path");
  if (rawPath) {
    const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
    requestUrl.searchParams.delete("path");
    const query = requestUrl.searchParams.toString();
    request.url = `/api/${path}${query ? `?${query}` : ""}`;
  }

  return app(request, response);
}
