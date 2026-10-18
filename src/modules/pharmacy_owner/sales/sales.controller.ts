import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { InvoicePdfSize } from "./sales.constant";
import { SalesService } from "./sales.service";

/**
 * Preview sale calculation (Dry-run).
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
const previewSale = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const result = await SalesService.previewSale(pharmacyId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sale preview calculated successfully",
    data: result,
  });
});

/**
 * Confirm and persist sale in an atomic database transaction.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
const confirmSale = catchAsync(async (req: Request, res: Response) => {
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

  const result = await SalesService.confirmSale(
    pharmacyId,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Sale completed successfully",
    data: result,
  });
});

/**
 * List sales for authenticated pharmacy with role-based filtering.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
const getSales = catchAsync(async (req: Request, res: Response) => {
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

  const result = await SalesService.getSales(pharmacyId, user, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sales retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

/**
 * Look up any invoice by invoice number within the pharmacy.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
const getSaleByInvoiceNo = catchAsync(async (req: Request, res: Response) => {
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

  const { invoiceNo } = req.params;
  const result = await SalesService.getSaleByInvoiceNo(
    pharmacyId,
    user,
    invoiceNo as string
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Invoice retrieved successfully",
    data: result,
  });
});

/**
 * Get sale details by ID.
 * Strict creator ownership applies to Cashier and Staff.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
const getSaleById = catchAsync(async (req: Request, res: Response) => {
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

  const { id } = req.params;
  const result = await SalesService.getSaleById(
    pharmacyId,
    user,
    id as string
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sale details retrieved successfully",
    data: result,
  });
});

/**
 * Get structured invoice JSON.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
const getSaleInvoiceJSON = catchAsync(async (req: Request, res: Response) => {
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

  const { id } = req.params;
  const result = await SalesService.getSaleInvoiceJSON(
    pharmacyId,
    user,
    id as string
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Invoice data retrieved successfully",
    data: result,
  });
});

/**
 * Generate invoice PDF (A4 or 80mm thermal receipt).
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
const getSaleInvoicePDF = catchAsync(async (req: Request, res: Response) => {
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

  const { id } = req.params;
  const size = (req.query.size as InvoicePdfSize) || "a4";

  const { buffer, invoiceNo } = await SalesService.getSaleInvoicePDF(
    pharmacyId,
    user,
    id as string,
    size
  );

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="Invoice-${invoiceNo}.pdf"`
  );
  res.status(httpStatus.OK).send(buffer);
});

/**
 * Cancel a sale atomically.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
const cancelSale = catchAsync(async (req: Request, res: Response) => {
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

  const { id } = req.params;
  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await SalesService.cancelSale(
    pharmacyId,
    user,
    id as string,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sale cancelled successfully",
    data: result,
  });
});

export const SalesController = {
  previewSale,
  confirmSale,
  getSales,
  getSaleByInvoiceNo,
  getSaleById,
  getSaleInvoiceJSON,
  getSaleInvoicePDF,
  cancelSale,
};
