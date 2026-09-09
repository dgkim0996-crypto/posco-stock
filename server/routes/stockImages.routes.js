import express from "express";

const router = express.Router();
const FILE_PATTERN = /^[A-Za-z0-9-]+\.png(?:\?\d+)?$/;
const TOSS_IMAGE_BASE = "https://static.toss.im/png-icons/securities/icn-sec-fill-";

// 토스 이미지 서버의 외부 사이트 직접 로딩 제한을 피하고 동일 출처로 원본 PNG를 전달한다.
router.get("/stock-images/:file", async (req, res, next) => {
  try {
    const file = req.params.file;
    if (!FILE_PATTERN.test(file)) return res.status(400).json({ error: "잘못된 종목 이미지 경로입니다." });

    const response = await fetch(`${TOSS_IMAGE_BASE}${file}`, {
      headers: { Accept: "image/png,image/*;q=0.8" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return res.status(response.status === 404 ? 404 : 502).json({ error: "종목 이미지를 불러오지 못했습니다." });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return res.status(502).json({ error: "올바르지 않은 종목 이미지 응답입니다." });

    const image = Buffer.from(await response.arrayBuffer());
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    });
    return res.send(image);
  } catch (error) {
    return next(error);
  }
});

export default router;
