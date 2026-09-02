import ordersService from "../services/orders.service.js";

export const createOrder = (req, res, next) => {
  try {
    return res.status(201).json(ordersService.createOrder(req.body));
  } catch (error) {
    return next(error);
  }
};

export const getOrders = (req, res, next) => {
  try {
    return res.json({ items: ordersService.getAll(req.query.accountId) });
  } catch (error) {
    return next(error);
  }
};
