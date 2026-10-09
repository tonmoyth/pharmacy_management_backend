import { Request, Response } from "express";
import httpStatus from "http-status";
import { AdminPaymentManagementService } from "./payment_management.service";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";

const getPayments = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminPaymentManagementService.getPayments(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payments retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getPaymentDetails = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminPaymentManagementService.getPaymentDetails(
    req.params.id as string
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment details retrieved successfully",
    data: result,
  });
});

const approveRenewalPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminPaymentManagementService.approveRenewalPayment(
    req.params.id as string,
    req.user,
    req.ip,
    req.headers["user-agent"]
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Renewal payment approved successfully",
    data: result,
  });
});

const rejectRenewalPayment = catchAsync(async (req: Request, res: Response) => {
  const { reason } = req.body;
  const result = await AdminPaymentManagementService.rejectRenewalPayment(
    req.params.id as string,
    reason,
    req.user,
    req.ip,
    req.headers["user-agent"]
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Renewal payment rejected successfully",
    data: result,
  });
});

const refundPayment = catchAsync(async (req: Request, res: Response) => {
  const { note } = req.body;
  const result = await AdminPaymentManagementService.refundPayment(
    req.params.id as string,
    note,
    req.user,
    req.ip,
    req.headers["user-agent"]
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment refunded successfully",
    data: result,
  });
});

export const AdminPaymentManagementController = {
  getPayments,
  getPaymentDetails,
  approveRenewalPayment,
  rejectRenewalPayment,
  refundPayment,
};
