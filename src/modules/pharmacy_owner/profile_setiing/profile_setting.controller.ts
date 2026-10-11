import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { ProfileSettingService } from "./profile_setting.service";

const getProfile = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const result = await ProfileSettingService.getProfile(pharmacyId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy profile retrieved successfully",
    data: result,
  });
});

const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const user = req.user
    ? {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role,
      }
    : undefined;

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await ProfileSettingService.updateProfile(
    pharmacyId,
    req.body,
    req.file,
    user,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy profile updated successfully",
    data: result,
  });
});

const updateSettings = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const user = req.user
    ? {
        id: req.user.id,
        name: req.user.name,
        role: req.user.role,
      }
    : undefined;

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await ProfileSettingService.updateSettings(
    pharmacyId,
    req.body,
    user,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy settings updated successfully",
    data: result,
  });
});

export const ProfileSettingController = {
  getProfile,
  updateProfile,
  updateSettings,
};
