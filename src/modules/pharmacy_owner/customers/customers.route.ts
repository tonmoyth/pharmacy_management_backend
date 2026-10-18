import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import validateRequest from "../../../middlewares/validateRequest";
import { CustomerController } from "./customers.controller";
import { CustomerValidation } from "./customers.validation";

const customerRouter = express.Router();
const dueRouter = express.Router();

/**
 * Customer Routes (mounted at /customers and /pharmacy/customers)
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */

// 1. List customers (with search, hasDue filter, pagination, financial totals)
customerRouter.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(CustomerValidation.getCustomersQueryZodSchema),
  CustomerController.getCustomers
);

// 2. Create customer
customerRouter.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(CustomerValidation.createCustomerZodSchema),
  CustomerController.createCustomer
);

// 3. Get customer details
customerRouter.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  CustomerController.getCustomerById
);

// 4. Update customer
customerRouter.patch(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(CustomerValidation.updateCustomerZodSchema),
  CustomerController.updateCustomer
);

// 5. Get customer sales history (OWN: all, CSH/STF: own sales only)
customerRouter.get(
  "/:id/sales",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(CustomerValidation.getCustomerSalesQueryZodSchema),
  CustomerController.getCustomerSales
);

// 6. Get customer due ledger
customerRouter.get(
  "/:id/ledger",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  CustomerController.getCustomerLedger
);

// 7. Collect customer due payment
customerRouter.post(
  "/:id/due-payments",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(CustomerValidation.createDuePaymentZodSchema),
  CustomerController.createDuePayment
);

// 8. Get customer due payment history
customerRouter.get(
  "/:id/due-payments",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  validateRequest(CustomerValidation.getDuePaymentsQueryZodSchema),
  CustomerController.getDuePayments
);

/**
 * Due Collection Routes (mounted at /dues and /pharmacy/dues)
 * Roles: PHARMACY_OWNER, CASHIER, STAFF
 */

// GET /dues/customers - List customers with dueBalance > 0
dueRouter.get(
  "/customers",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  CustomerController.getDueCustomers
);

export const CustomerRoutes = customerRouter;
export const CustomerDueRoutes = dueRouter;
