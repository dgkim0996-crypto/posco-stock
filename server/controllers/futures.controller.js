import futuresService from "../services/futures.service.js";
export const getFutures=async(req,res,next)=>{try{return res.json({items:await futuresService.getAll(req.accountId)});}catch(error){return next(error);}};
export const openFuture=async(req,res,next)=>{try{return res.status(201).json(await futuresService.open(req.accountId,req.body));}catch(error){return next(error);}};
export const closeFuture=async(req,res,next)=>{try{return res.json(await futuresService.close(req.accountId,req.params.positionId));}catch(error){return next(error);}};
