import express from "express";
import { AdminPharmacyController } from "./pharmacy.controller";
import validateRequest from "../../../middlewares/validateRequest";
import { suspendPharmacySchema, deactivatePharmacySchema } from "./pharmacy.validation";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";

const router = express.Router();

router.get(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  AdminPharmacyController.getPharmacies
);

router.get(
  "/:id",
  checkAuth(Role.SUPER_ADMIN),
  AdminPharmacyController.getPharmacyDetails
);

router.post(
  "/:id/activate",
  checkAuth(Role.SUPER_ADMIN),
  AdminPharmacyController.activatePharmacy
);

router.post(
  "/:id/suspend",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(suspendPharmacySchema),
  AdminPharmacyController.suspendPharmacy
);

router.post(
  "/:id/deactivate",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(deactivatePharmacySchema),
  AdminPharmacyController.deactivatePharmacy
);

router.get(
  "/:id/subscriptions",
  checkAuth(Role.SUPER_ADMIN),
  AdminPharmacyController.getPharmacySubscriptions
);

router.get(
  "/:id/payments",
  checkAuth(Role.SUPER_ADMIN),
  AdminPharmacyController.getPharmacyPayments
);

export const AdminPharmacyRoutes = router;
