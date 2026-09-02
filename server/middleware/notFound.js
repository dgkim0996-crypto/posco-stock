export const notFound = (req, res, next) => {
  res.status(404).json({
    error: "API를 찾을 수 없습니다.",
  });
};
