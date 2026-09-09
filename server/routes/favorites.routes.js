import { Router } from "express";
import {
  addFavorite,
  getFavorites,
  removeFavorite,
} from "../controllers/favorites.controller.js";
import { requireAccount } from "../middleware/auth.js";

const router = Router();

router.use("/accounts", requireAccount);
router.get("/accounts/me/favorites", getFavorites);
router.post("/accounts/me/favorites", addFavorite);
router.delete("/accounts/me/favorites/:symbol", removeFavorite);

export default router;
