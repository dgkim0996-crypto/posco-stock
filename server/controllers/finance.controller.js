import financeService from "../services/finance.service.js";
export const getFinance=async(req,res,next)=>{try{return res.json(await financeService.getAll(req.accountId));}catch(error){return next(error);}};
export const executeFinance=async(req,res,next)=>{try{return res.status(201).json(await financeService.execute(req.accountId,req.params.product,req.body.amount));}catch(error){return next(error);}};
export const settleFinance=async(req,res,next)=>{try{return res.json(await financeService.settle(req.accountId,req.params.product));}catch(error){return next(error);}};
