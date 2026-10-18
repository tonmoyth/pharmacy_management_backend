import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { CustomerService } from "./customers.service";
import { ICustomerUserContext } from "./customers.interface";

const getCustomers = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const result = await CustomerService.getCustomers(pharmacyId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Customers retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const createCustomer = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: ICustomerUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await CustomerService.createCustomer(
    pharmacyId,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Customer created successfully",
    data: result,
  });
});

const getCustomerById = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const result = await CustomerService.getCustomerById(
    pharmacyId,
    req.params.id as string
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Customer details retrieved successfully",
    data: result,
  });
});

const updateCustomer = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: ICustomerUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await CustomerService.updateCustomer(
    pharmacyId,
    user,
    req.params.id as string,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Customer updated successfully",
    data: result,
  });
});

const getCustomerSales = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: ICustomerUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const result = await CustomerService.getCustomerSales(
    pharmacyId,
    user,
    req.params.id as string,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Customer sales retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getCustomerLedger = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;

  const result = await CustomerService.getCustomerLedger(
    pharmacyId,
    req.params.id as string,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Customer ledger retrieved successfully",
    meta: result.meta,
    data: {
      summary: result.summary,
      entries: result.data,
    },
  });
});

const getDueCustomers = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const result = await CustomerService.getDueCustomers(pharmacyId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Due customers retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const createDuePayment = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: ICustomerUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await CustomerService.createDuePayment(
    pharmacyId,
    user,
    req.params.id as string,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Due payment collected successfully",
    data: result,
  });
});

const getDuePayments = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const result = await CustomerService.getDuePayments(
    pharmacyId,
    req.params.id as string,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Due payments retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

export const CustomerController = {
  getCustomers,
  createCustomer,
  getCustomerById,
  updateCustomer,
  getCustomerSales,
  getCustomerLedger,
  getDueCustomers,
  createDuePayment,
  getDuePayments,
};
