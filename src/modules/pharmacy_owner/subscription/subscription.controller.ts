import { Request, Response } from "express";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import httpStatus from "http-status";
import { SubscriptionService } from "./subscription.service";
import AppError from "../../../errors/AppError";

const getSubscription = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found");

  const result = await SubscriptionService.getSubscription(pharmacyId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Subscription retrieved successfully",
    data: result,
  });
});

const renewSubscription = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found");

  const screenshotPath = req.file?.path;
  
  const result = await SubscriptionService.renewSubscription(pharmacyId, req.body, screenshotPath);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Renewal payment submitted successfully",
    data: result,
  });
});

const getPayments = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found");

  const result = await SubscriptionService.getPayments(pharmacyId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payments retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getPaymentReceipt = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found");
  
  const { id } = req.params;
  const format = req.query.format as string;

  const result = await SubscriptionService.getPaymentReceipt(pharmacyId, id as string);

  if (format === 'pdf') {
    // Project PDF generation limitation reported in return data
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "PDF generation is not natively supported by the existing project. Returning structured data instead.",
      data: result,
    });
    return;
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Receipt retrieved successfully",
    data: result,
  });
});

export const SubscriptionController = {
  getSubscription,
  renewSubscription,
  getPayments,
  getPaymentReceipt,
};
