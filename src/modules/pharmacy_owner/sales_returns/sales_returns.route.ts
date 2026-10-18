import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import validateRequest from "../../../middlewares/validateRequest";
import { SalesReturnController } from "./sales_returns.controller";
import { SalesReturnValidation } from "./sales_returns.validation";

const router = express.Router();

/**
 * Return a paginated list of sales returns belonging to the authenticated pharmacy.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(SalesReturnValidation.getSalesReturnsQueryZodSchema),
  SalesReturnController.getSalesReturns
);

/**
 * Create a sales return, atomically restoring stock and adjusting customer due.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(SalesReturnValidation.createSalesReturnZodSchema),
  SalesReturnController.createSalesReturn
);

/**
 * Return complete sales return details by ID.
 * Strict creator ownership for Cashier and Staff.
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */
router.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  SalesReturnController.getSalesReturnById
);

export const SalesReturnRoutes = router;
