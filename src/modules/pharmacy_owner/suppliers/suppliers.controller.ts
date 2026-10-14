import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { SupplierService } from "./suppliers.service";

/**
 * List suppliers belonging to the authenticated user's pharmacy.
 * Accessible by PHARMACY_OWNER and STAFF.
 * Staff response is filtered to exclude dueBalance and financial details.
 */
const getSuppliers = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const role = req.user.role;
  const result = await SupplierService.getSuppliers(
    pharmacyId,
    role,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Suppliers retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

/**
 * Create a supplier for the authenticated user's pharmacy.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const createSupplier = catchAsync(async (req: Request, res: Response) => {
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

  const result = await SupplierService.createSupplier(
    pharmacyId,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Supplier created successfully",
    data: result,
  });
});

/**
 * View detailed supplier info and financial summary (totalPurchase, totalPaid, dueBalance).
 * PHARMACY_OWNER only.
 */
const getSupplierById = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const result = await SupplierService.getSupplierById(pharmacyId, id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Supplier details retrieved successfully",
    data: result,
  });
});

/**
 * Update supplier information or active status.
 * PHARMACY_OWNER only.
 */
const updateSupplier = catchAsync(async (req: Request, res: Response) => {
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

  const result = await SupplierService.updateSupplier(
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
    message: "Supplier updated successfully",
    data: result,
  });
});

/**
 * Record a payment made to a supplier.
 * PHARMACY_OWNER only.
 */
const recordSupplierPayment = catchAsync(async (req: Request, res: Response) => {
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

  const result = await SupplierService.recordSupplierPayment(
    pharmacyId,
    id as string,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Supplier payment recorded successfully",
    data: result,
  });
});

/**
 * Return payment history for a supplier.
 * PHARMACY_OWNER only.
 */
const getSupplierPayments = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const result = await SupplierService.getSupplierPayments(
    pharmacyId,
    id as string,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Supplier payment history retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

/**
 * Return chronological supplier ledger with purchases, returns, payments, and running balance.
 * PHARMACY_OWNER only.
 */
const getSupplierLedger = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const result = await SupplierService.getSupplierLedger(
    pharmacyId,
    id as string,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Supplier ledger retrieved successfully",
    meta: result.meta,
    summary: result.summary,
    data: result.data,
  });
});

export const SupplierController = {
  getSuppliers,
  createSupplier,
  getSupplierById,
  updateSupplier,
  recordSupplierPayment,
  getSupplierPayments,
  getSupplierLedger,
};
