import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { PurchaseReturnService } from "./purchase_returns.service";

/**
 * Return paginated list of purchase returns belonging to the authenticated pharmacy.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const getPurchaseReturns = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const result = await PurchaseReturnService.getPurchaseReturns(
    pharmacyId,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchase returns retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

/**
 * Return complete purchase return details by ID.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const getPurchaseReturnById = catchAsync(
  async (req: Request, res: Response) => {
    const pharmacyId = req.user?.pharmacyId;
    if (!pharmacyId) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Pharmacy ID not found for this user"
      );
    }

    const { id } = req.params;
    const result = await PurchaseReturnService.getPurchaseReturnById(
      pharmacyId,
      id as string
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Purchase return details retrieved successfully",
      data: result,
    });
  }
);

/**
 * Create a purchase return, update inventory, and handle supplier credit atomically.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const createPurchaseReturn = catchAsync(async (req: Request, res: Response) => {
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

  const result = await PurchaseReturnService.createPurchaseReturn(
    pharmacyId,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Purchase return created successfully",
    data: result,
  });
});

export const PurchaseReturnController = {
  getPurchaseReturns,
  getPurchaseReturnById,
  createPurchaseReturn,
};
