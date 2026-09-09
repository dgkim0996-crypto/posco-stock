import service from "../services/pendingOrders.service.js";
export const getPendingOrders=async(req,res,next)=>{try{return res.json({items:await service.getAll(req.accountId)});}catch(error){return next(error);}};
export const createPendingOrder=async(req,res,next)=>{try{return res.status(201).json(await service.create(req.accountId,req.body));}catch(error){return next(error);}};
export const cancelPendingOrder=async(req,res,next)=>{try{return res.json(await service.remove(req.accountId,req.params.pendingId));}catch(error){return next(error);}};
export const amendPendingOrder=async(req,res,next)=>{try{return res.json(await service.amend(req.accountId,req.params.pendingId,req.body));}catch(error){return next(error);}};
