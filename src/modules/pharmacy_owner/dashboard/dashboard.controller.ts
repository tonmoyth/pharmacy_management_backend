import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import AppError from "../../../errors/AppError";
import { DashboardService } from "./dashboard.service";
import { IDashboardUserContext } from "./dashboard.interface";

/**
 * GET /dashboard
 * Returns role-appropriate dashboard metrics for the authenticated user and pharmacy.
 */
const getDashboard = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;

  if (!pharmacyId) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Pharmacy context is required to access the dashboard."
    );
  }

  const user: IDashboardUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
    pharmacyId,
  };

  const result = await DashboardService.getDashboard(pharmacyId, user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Dashboard data retrieved successfully",
    data: result,
  });
});

export const DashboardController = {
  getDashboard,
};
