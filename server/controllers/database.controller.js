import databaseService from "../services/database.service.js";

export const getDatabaseStatus = async (_req, res, next) => {
  try {
    return res.json(await databaseService.getStatus());
  } catch (error) {
    return next(error);
  }
};
