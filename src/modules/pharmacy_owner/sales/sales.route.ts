import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import validateRequest from "../../../middlewares/validateRequest";
import { SalesController } from "./sales.controller";
import { SalesValidation } from "./sales.validation";

const router = express.Router();

/**
 * Preview sale calculation (Dry run).
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.post(
  "/preview",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(SalesValidation.previewSaleZodSchema),
  SalesController.previewSale
);

/**
 * Look up any invoice by invoice number within the pharmacy.
 * MUST be declared before /:id to prevent route shadowing.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.get(
  "/by-invoice/:invoiceNo",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  SalesController.getSaleByInvoiceNo
);

/**
 * List sales with role-based filtering, date range, pagination, and status filters.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(SalesValidation.getSalesQueryZodSchema),
  SalesController.getSales
);

/**
 * Confirm and record a sale with atomic inventory reduction.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(SalesValidation.confirmSaleZodSchema),
  SalesController.confirmSale
);

/**
 * Generate invoice PDF in A4 or 80mm thermal receipt format.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.get(
  "/:id/invoice/pdf",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(SalesValidation.invoicePdfQueryZodSchema),
  SalesController.getSaleInvoicePDF
);

/**
 * Retrieve structured invoice JSON representation.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.get(
  "/:id/invoice",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  SalesController.getSaleInvoiceJSON
);

/**
 * Cancel a sale atomically and restore stock.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.post(
  "/:id/cancel",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(SalesValidation.cancelSaleZodSchema),
  SalesController.cancelSale
);

/**
 * Retrieve complete sale details by ID.
 * Strict creator ownership for Cashier and Staff.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  SalesController.getSaleById
);

export const SalesRoutes = router;
