import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import validateRequest from "../../../middlewares/validateRequest";
import { PurchaseReturnController } from "./purchase_returns.controller";
import { PurchaseReturnValidation } from "./purchase_returns.validation";

const router = express.Router();

/**
 * Return a paginated list of purchase returns belonging to the authenticated pharmacy.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(PurchaseReturnValidation.getPurchaseReturnsQueryZodSchema),
  PurchaseReturnController.getPurchaseReturns
);

/**
 * Create a purchase return and update inventory and supplier accounting atomically.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(PurchaseReturnValidation.createPurchaseReturnZodSchema),
  PurchaseReturnController.createPurchaseReturn
);

/**
 * Return complete purchase return details by ID.
 * Roles: PHARMACY_OWNER, STAFF
 */
router.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  PurchaseReturnController.getPurchaseReturnById
);

export const PurchaseReturnRoutes = router;
