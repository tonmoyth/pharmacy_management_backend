import { Request, Response } from "express";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import httpStatus from "http-status";
import { PublicPlanService } from "./plan.public.service";

const getActivePlans = catchAsync(async (req: Request, res: Response) => {
  const result = await PublicPlanService.getActivePlans();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Active plans retrieved successfully",
    data: result,
  });
});

export const PublicPlanController = {
  getActivePlans,
};
