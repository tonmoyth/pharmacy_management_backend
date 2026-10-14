import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import validateRequest from "../../../middlewares/validateRequest";
import { SupplierController } from "./suppliers.controller";
import { SupplierValidation } from "./suppliers.validation";

const router = express.Router();

/**
 * List suppliers belonging to authenticated user's pharmacy.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  SupplierController.getSuppliers
);

/**
 * Create a supplier for authenticated user's pharmacy.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(SupplierValidation.createSupplierZodSchema),
  SupplierController.createSupplier
);

/**
 * View supplier financial details and totals.
 * Role: PHARMACY_OWNER only
 */
router.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER),
  SupplierController.getSupplierById
);

/**
 * Update supplier details or active status.
 * Role: PHARMACY_OWNER only
 */
router.patch(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER),
  validateRequest(SupplierValidation.updateSupplierZodSchema),
  SupplierController.updateSupplier
);

/**
 * Record a payment made to a supplier.
 * Role: PHARMACY_OWNER only
 */
router.post(
  "/:id/payments",
  checkAuth(Role.PHARMACY_OWNER),
  validateRequest(SupplierValidation.recordSupplierPaymentZodSchema),
  SupplierController.recordSupplierPayment
);

/**
 * View payment history for a supplier.
 * Role: PHARMACY_OWNER only
 */
router.get(
  "/:id/payments",
  checkAuth(Role.PHARMACY_OWNER),
  SupplierController.getSupplierPayments
);

/**
 * View chronological supplier ledger.
 * Role: PHARMACY_OWNER only
 */
router.get(
  "/:id/ledger",
  checkAuth(Role.PHARMACY_OWNER),
  SupplierController.getSupplierLedger
);

export const SupplierRoutes = router;
