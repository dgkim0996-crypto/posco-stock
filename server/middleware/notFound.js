// 앞선 라우터 중 어느 것에도 매칭되지 않은 API 경로를 일관된 404 JSON으로 끝낸다.
export const notFound = (req, res, next) => {
  res.status(404).json({
    error: "API를 찾을 수 없습니다.",
  });
};
