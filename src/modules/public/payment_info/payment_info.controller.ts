import { Request, Response } from "express";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import httpStatus from "http-status";
import { PublicPaymentInfoService } from "./payment_info.service";

const getPaymentInfo = catchAsync(async (req: Request, res: Response) => {
  const result = await PublicPaymentInfoService.getPaymentInfo();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment info retrieved successfully",
    data: result || null,
  });
});

export const PublicPaymentInfoController = {
  getPaymentInfo,
};
