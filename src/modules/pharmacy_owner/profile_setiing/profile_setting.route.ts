import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import { upload } from "../../../middlewares/upload";
import validateRequest from "../../../middlewares/validateRequest";
import { ProfileSettingController } from "./profile_setting.controller";
import { ProfileSettingValidation } from "./profile_setting.validation";

const router = express.Router();

router.get(
  "/profile",
  checkAuth(Role.PHARMACY_OWNER),
  ProfileSettingController.getProfile
);

router.patch(
  "/profile",
  checkAuth(Role.PHARMACY_OWNER),
  upload.single("logo"),
  (req, res, next) => {
    if (req.body?.data) {
      try {
        req.body = JSON.parse(req.body.data);
      } catch (error) {
        // Continue if parsing fails, Zod will catch invalid structures
      }
    }
    // Clean up empty string logo field if submitted via form-data
    if (req.body?.logo === "" || req.body?.logo === undefined) {
      delete req.body.logo;
    }
    next();
  },
  validateRequest(ProfileSettingValidation.updatePharmacyProfileSchema),
  ProfileSettingController.updateProfile
);

router.patch(
  "/settings",
  checkAuth(Role.PHARMACY_OWNER),
  validateRequest(ProfileSettingValidation.updatePharmacySettingsSchema),
  ProfileSettingController.updateSettings
);

export const PharmacyProfileSettingRoutes = router;
