import { Request, Response } from "express";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import httpStatus from "http-status";
import { PaymentSettingService } from "./payment_setting.service";
import { User, Role } from "@prisma/client";

const getSettings = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentSettingService.getSettings();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Settings retrieved successfully",
    data: result || null,
  });
});

const createSettings = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as { id: string; name: string; role: Role };
  
  const result = await PaymentSettingService.createSettings(req.body, user);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Settings created successfully",
    data: result,
  });
});

const updateSettings = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as { id: string; name: string; role: Role };
  
  const result = await PaymentSettingService.updateSettings(req.body, user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Settings updated successfully",
    data: result,
  });
});

export const PaymentSettingController = {
  getSettings,
  createSettings,
  updateSettings,
};
