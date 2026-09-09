import favoritesService from "../services/favorites.service.js";

export const getFavorites = async (req, res, next) => {
  try {
    return res.json({ items: await favoritesService.getAll(req.accountId) });
  } catch (error) {
    return next(error);
  }
};

export const addFavorite = async (req, res, next) => {
  try {
    return res.status(201).json(await favoritesService.add(req.accountId, req.body.symbol));
  } catch (error) {
    return next(error);
  }
};

export const removeFavorite = async (req, res, next) => {
  try {
    return res.json(await favoritesService.remove(req.accountId, req.params.symbol));
  } catch (error) {
    return next(error);
  }
};
