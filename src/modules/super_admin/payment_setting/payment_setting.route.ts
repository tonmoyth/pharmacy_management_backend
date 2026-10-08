import express from "express";
import validateRequest from "../../../middlewares/validateRequest";
import { PaymentSettingValidation } from "./payment_setting.validation";
import { PaymentSettingController } from "./payment_setting.controller";
import { checkAuth } from "../../../middlewares/checkAuth";
import { Role } from "@prisma/client";

const router = express.Router();

router.get(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  PaymentSettingController.getSettings
);

router.post(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(PaymentSettingValidation.createPaymentSettingsZodSchema),
  PaymentSettingController.createSettings
);

router.patch(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(PaymentSettingValidation.updatePaymentSettingsZodSchema),
  PaymentSettingController.updateSettings
);

export const PaymentSettingRoutes = router;
