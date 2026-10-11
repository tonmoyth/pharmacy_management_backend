import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { StaffService } from "./staff.service";

const getStaff = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const result = await StaffService.getStaff(pharmacyId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff list retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const createStaff = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const owner = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await StaffService.createStaff(
    pharmacyId,
    owner,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Staff account created successfully",
    data: result,
  });
});

const getStaffById = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const { id } = req.params;
  const result = await StaffService.getStaffById(pharmacyId, id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff details retrieved successfully",
    data: result,
  });
});

const updateStaff = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const owner = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const { id } = req.params;
  const result = await StaffService.updateStaff(
    pharmacyId,
    id as string,
    owner,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff updated successfully",
    data: result,
  });
});

const updateStaffStatus = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const owner = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const { id } = req.params;
  const result = await StaffService.updateStaffStatus(
    pharmacyId,
    id as string,
    owner,
    req.body.status,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff status updated successfully",
    data: result,
  });
});

const resetStaffPassword = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const owner = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const { id } = req.params;
  await StaffService.resetStaffPassword(
    pharmacyId,
    id as string,
    owner,
    req.body.newPassword,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Staff password reset successfully and credentials sent via email",
    data: null,
  });
});

export const StaffController = {
  getStaff,
  createStaff,
  getStaffById,
  updateStaff,
  updateStaffStatus,
  resetStaffPassword,
};
