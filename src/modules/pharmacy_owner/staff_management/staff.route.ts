import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import validateRequest from "../../../middlewares/validateRequest";
import { StaffController } from "./staff.controller";
import { StaffValidation } from "./staff.validation";

const router = express.Router();

router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER),
  StaffController.getStaff
);

router.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER),
  validateRequest(StaffValidation.createStaffZodSchema),
  StaffController.createStaff
);

router.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER),
  StaffController.getStaffById
);

router.patch(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER),
  validateRequest(StaffValidation.updateStaffZodSchema),
  StaffController.updateStaff
);

router.patch(
  "/:id/status",
  checkAuth(Role.PHARMACY_OWNER),
  validateRequest(StaffValidation.updateStaffStatusZodSchema),
  StaffController.updateStaffStatus
);

router.post(
  "/:id/reset-password",
  checkAuth(Role.PHARMACY_OWNER),
  validateRequest(StaffValidation.resetStaffPasswordZodSchema),
  StaffController.resetStaffPassword
);

export const OwnerStaffRoutes = router;
