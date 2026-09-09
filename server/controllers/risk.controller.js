import service from "../services/risk.service.js";
export const evaluateRisk=async(req,res,next)=>{try{return res.json(await service.evaluate(req.accountId,{autoLiquidate:req.query.autoLiquidate!=="false"}));}catch(error){return next(error);}};
