import { Request, Response } from "express";

import httpStatus from "http-status";
import { AdminApplicationService } from "./application.service";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";

const getApplications = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminApplicationService.getApplications(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Applications retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getApplicationDetails = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminApplicationService.getApplicationDetails(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Application details retrieved successfully",
    data: result,
  });
});

const approveApplication = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminApplicationService.approveApplication(
    req.params.id as string,
    req.user,
    req.ip,
    req.headers["user-agent"]
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Application approved successfully",
    data: result,
  });
});

const rejectApplication = catchAsync(async (req: Request, res: Response) => {
  const { reason } = req.body;
  const result = await AdminApplicationService.rejectApplication(
    req.params.id as string,
    reason,
    req.user,
    req.ip,
    req.headers["user-agent"]
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Application rejected successfully",
    data: result,
  });
});

export const AdminApplicationController = {
  getApplications,
  getApplicationDetails,
  approveApplication,
  rejectApplication,
};
