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

export const AdminApplicationController = {
  getApplications,
  getApplicationDetails,
};
