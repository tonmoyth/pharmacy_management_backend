import express from "express";
import { AdminPaymentManagementController } from "./payment_management.controller";
import validateRequest from "../../../middlewares/validateRequest";
import { rejectPaymentSchema, refundPaymentSchema } from "./payment_management.validation";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";

const router = express.Router();

router.get(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  AdminPaymentManagementController.getPayments
);

router.get(
  "/:id",
  checkAuth(Role.SUPER_ADMIN),
  AdminPaymentManagementController.getPaymentDetails
);

router.post(
  "/:id/approve",
  checkAuth(Role.SUPER_ADMIN),
  AdminPaymentManagementController.approveRenewalPayment
);

router.post(
  "/:id/reject",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(rejectPaymentSchema),
  AdminPaymentManagementController.rejectRenewalPayment
);

router.post(
  "/:id/refund",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(refundPaymentSchema),
  AdminPaymentManagementController.refundPayment
);

export const AdminPaymentManagementRoutes = router;
