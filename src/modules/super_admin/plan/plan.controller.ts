import { Request, Response } from "express";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import httpStatus from "http-status";
import { PlanService } from "./plan.service";

const createPlan = catchAsync(async (req: Request, res: Response) => {
  const result = await PlanService.createPlan(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Plan created successfully",
    data: result,
  });
});

const getAllPlans = catchAsync(async (req: Request, res: Response) => {
  const result = await PlanService.getAllPlans(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plans retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getPlanById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await PlanService.getPlanById(id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plan details retrieved successfully",
    data: result,
  });
});

const updatePlan = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await PlanService.updatePlan(id as string, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plan updated successfully",
    data: result,
  });
});

const updatePlanStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await PlanService.updatePlanStatus(id as string, req.body.status);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Plan status updated successfully",
    data: result,
  });
});

export const PlanController = {
  createPlan,
  getAllPlans,
  getPlanById,
  updatePlan,
  updatePlanStatus,
};
