import express from "express";
import { checkAuth } from "../../../middlewares/checkAuth";
import { Role } from "@prisma/client";
import { SubscriptionController } from "./subscription.controller";
import validateRequest from "../../../middlewares/validateRequest";
import { renewSubscriptionSchema } from "./subscription.validation";
import { upload } from "../../../middlewares/upload";

const router = express.Router();

router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER),
  SubscriptionController.getSubscription
);

router.post(
  "/renew",
  checkAuth(Role.PHARMACY_OWNER),
  upload.single("screenshot"),
  (req, res, next) => {
    if (req.body.data) {
      try {
        req.body = JSON.parse(req.body.data);
      } catch (error) {
        // Continue if parsing fails, Zod will catch invalid structures
      }
    }
    next();
  },
  validateRequest(renewSubscriptionSchema),
  SubscriptionController.renewSubscription
);

router.get(
  "/payments",
  checkAuth(Role.PHARMACY_OWNER),
  SubscriptionController.getPayments
);

router.get(
  "/payments/:id/receipt",
  checkAuth(Role.PHARMACY_OWNER),
  SubscriptionController.getPaymentReceipt
);

export const OwnerSubscriptionRoutes = router;
