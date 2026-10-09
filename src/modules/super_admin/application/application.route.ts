import express from "express";
import { AdminApplicationController } from "./application.controller";
import validateRequest from "../../../middlewares/validateRequest";
import { rejectApplicationValidationSchema } from "./application.validation";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";

const router = express.Router();

router.get(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  AdminApplicationController.getApplications
);

router.get(
  "/:id",
  checkAuth(Role.SUPER_ADMIN),
  AdminApplicationController.getApplicationDetails
);

router.post(
  "/:id/approve",
  checkAuth(Role.SUPER_ADMIN),
  AdminApplicationController.approveApplication
);


router.post(
  "/:id/reject",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(rejectApplicationValidationSchema),
  AdminApplicationController.rejectApplication
);

export const AdminApplicationRoutes = router;
