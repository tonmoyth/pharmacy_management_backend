import { Request, Response } from "express";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import httpStatus from "http-status";
import { AdminReportsService } from "./reports.service";

const getRevenueReport = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminReportsService.getRevenueReport(req.query);
  const format = req.query.format as string;
  
  if (format === 'xlsx' || format === 'pdf') {
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: `The ${format.toUpperCase()} export is not natively supported by the backend without additional libraries. Returning JSON structured data instead.`,
      data: result,
    });
    return;
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Revenue report retrieved successfully",
    data: result,
  });
});

const getSubscriptionsReport = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminReportsService.getSubscriptionsReport();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Subscriptions report retrieved successfully",
    data: result,
  });
});

const getPharmacyGrowthReport = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminReportsService.getPharmacyGrowthReport(req.query);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy growth report retrieved successfully",
    data: result,
  });
});

export const AdminReportsController = {
  getRevenueReport,
  getSubscriptionsReport,
  getPharmacyGrowthReport,
};
