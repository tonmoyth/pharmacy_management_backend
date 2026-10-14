import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { PurchaseService } from "./purchases.service";

/**
 * Return paginated list of purchases belonging to the authenticated pharmacy.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const getPurchases = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const result = await PurchaseService.getPurchases(pharmacyId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchases retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

/**
 * Return complete purchase details by ID.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const getPurchaseById = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const result = await PurchaseService.getPurchaseById(pharmacyId, id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchase details retrieved successfully",
    data: result,
  });
});

/**
 * Create a purchase, update stock, and handle supplier payment/due atomically.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const createPurchase = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const user = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await PurchaseService.createPurchase(
    pharmacyId,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Purchase created successfully",
    data: {
      ...result.purchase,
      warnings: result.warnings,
    },
  });
});

/**
 * Check whether a purchase can be edited.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const checkPurchaseEditable = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const result = await PurchaseService.checkPurchaseEditable(
    pharmacyId,
    id as string
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchase edit check completed",
    data: result,
  });
});

/**
 * Edit an existing purchase if dependent transactions do not exist.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const updatePurchase = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const user = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await PurchaseService.updatePurchase(
    pharmacyId,
    id as string,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchase updated successfully",
    data: {
      ...result.purchase,
      warnings: result.warnings,
    },
  });
});

/**
 * Cancel a purchase if no sales/returns depend on its batches.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const cancelPurchase = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const user = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await PurchaseService.cancelPurchase(
    pharmacyId,
    id as string,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: result.purchase,
  });
});

export const PurchaseController = {
  getPurchases,
  getPurchaseById,
  createPurchase,
  checkPurchaseEditable,
  updatePurchase,
  cancelPurchase,
};
