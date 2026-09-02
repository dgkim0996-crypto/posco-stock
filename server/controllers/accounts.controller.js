import accountsService from "../services/accounts.service.js";

export const getAccountById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const accountId = parseInt(id, 10);

    if (isNaN(accountId)) {
      return res.status(400).json({ error: "잘못된 계좌 ID 형식입니다." });
    }

    const account = accountsService.getById(accountId);

    if (!account) {
      return res.status(404).json({ error: "계좌를 찾을 수 없습니다." });
    }

    return res.json(account);
  } catch (error) {
    next(error);
  }
};

export const getAccountHoldings = (req, res, next) => {
  try {
    const accountId = Number(req.params.id);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return res.status(400).json({ error: "잘못된 계좌 ID 형식입니다." });
    }

    const result = accountsService.getHoldings(accountId);
    if (!result) return res.status(404).json({ error: "계좌를 찾을 수 없습니다." });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
