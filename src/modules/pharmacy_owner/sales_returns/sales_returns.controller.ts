import { Request, Response } from "express";
import httpStatus from "http-status";
import sendResponse from "../../../utils/sendResponse";
import { SalesReturnService } from "./sales_returns.service";
import { ISalesReturnUserContext } from "./sales_returns.interface";
import { catchAsync } from "../../../shared/catchAsync";

const createSalesReturn = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: ISalesReturnUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await SalesReturnService.createSalesReturn(
    pharmacyId,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Sales return created successfully",
    data: result,
  });
});

const getSalesReturns = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: ISalesReturnUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const result = await SalesReturnService.getSalesReturns(
    pharmacyId,
    user,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sales returns retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getSalesReturnById = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: ISalesReturnUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const result = await SalesReturnService.getSalesReturnById(
    pharmacyId,
    user,
    req.params.id as string
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sales return retrieved successfully",
    data: result,
  });
});

export const SalesReturnController = {
  createSalesReturn,
  getSalesReturns,
  getSalesReturnById,
};
