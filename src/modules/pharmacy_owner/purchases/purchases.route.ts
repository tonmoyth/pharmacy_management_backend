import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import validateRequest from "../../../middlewares/validateRequest";
import { PurchaseController } from "./purchases.controller";
import { PurchaseValidation } from "./purchases.validation";

const router = express.Router();

/**
 * Return a paginated list of purchases belonging to the authenticated pharmacy.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(PurchaseValidation.getPurchasesQueryZodSchema),
  PurchaseController.getPurchases
);

/**
 * Create a purchase and increase inventory atomically.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(PurchaseValidation.createPurchaseZodSchema),
  PurchaseController.createPurchase
);

/**
 * Determine whether a purchase can be edited.
 * MUST be declared before /:id to prevent route shadowing.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.get(
  "/:id/edit-check",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  PurchaseController.checkPurchaseEditable
);

/**
 * Return complete purchase details by ID.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  PurchaseController.getPurchaseById
);

/**
 * Edit the purchase header and items only when edit-check rules pass.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.patch(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(PurchaseValidation.updatePurchaseZodSchema),
  PurchaseController.updatePurchase
);

/**
 * Cancel a purchase.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.post(
  "/:id/cancel",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(PurchaseValidation.cancelPurchaseZodSchema),
  PurchaseController.cancelPurchase
);

export const PurchaseRoutes = router;
