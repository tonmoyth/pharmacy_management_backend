import { Request, Response } from "express";
import httpStatus from "http-status";
import { AdminPharmacyService } from "./pharmacy.service";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";

const getPharmacies = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminPharmacyService.getPharmacies(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacies retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getPharmacyDetails = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminPharmacyService.getPharmacyDetails(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy details retrieved successfully",
    data: result,
  });
});

const activatePharmacy = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminPharmacyService.activatePharmacy(
    req.params.id as string,
    req.user,
    req.ip,
    req.headers["user-agent"]
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy activated successfully",
    data: result,
  });
});

const suspendPharmacy = catchAsync(async (req: Request, res: Response) => {
  const { reason } = req.body;
  const result = await AdminPharmacyService.suspendPharmacy(
    req.params.id as string,
    reason,
    req.user,
    req.ip,
    req.headers["user-agent"]
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy suspended successfully",
    data: result,
  });
});

const deactivatePharmacy = catchAsync(async (req: Request, res: Response) => {
  const { reason } = req.body;
  const result = await AdminPharmacyService.deactivatePharmacy(
    req.params.id as string,
    reason,
    req.user,
    req.ip,
    req.headers["user-agent"]
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy deactivated successfully",
    data: result,
  });
});

const getPharmacySubscriptions = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminPharmacyService.getPharmacySubscriptions(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy subscriptions retrieved successfully",
    data: result,
  });
});

const getPharmacyPayments = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminPharmacyService.getPharmacyPayments(req.params.id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Pharmacy payments retrieved successfully",
    data: result,
  });
});

export const AdminPharmacyController = {
  getPharmacies,
  getPharmacyDetails,
  activatePharmacy,
  suspendPharmacy,
  deactivatePharmacy,
  getPharmacySubscriptions,
  getPharmacyPayments,
};
