import service from "../services/settlements.service.js";
export const getSettlements=async(req,res,next)=>{try{return res.json(await service.getAll(req.accountId));}catch(error){return next(error);}};
export const getChargePolicies=async(req,res,next)=>{try{return res.json({items:await service.getPolicies()});}catch(error){return next(error);}};
