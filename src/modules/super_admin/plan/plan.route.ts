import express from "express";
import validateRequest from "../../../middlewares/validateRequest";
import { PlanValidation } from "./plan.validation";
import { PlanController } from "./plan.controller";
import { checkAuth } from "../../../middlewares/checkAuth";
import { Role } from "@prisma/client";

const router = express.Router();

router.post(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(PlanValidation.createPlanZodSchema),
  PlanController.createPlan
);

router.get(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  PlanController.getAllPlans
);

router.get(
  "/:id",
  checkAuth(Role.SUPER_ADMIN),
  PlanController.getPlanById
);

router.patch(
  "/:id",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(PlanValidation.updatePlanZodSchema),
  PlanController.updatePlan
);

router.patch(
  "/:id/status",
  checkAuth(Role.SUPER_ADMIN),
  validateRequest(PlanValidation.updatePlanStatusZodSchema),
  PlanController.updatePlanStatus
);

export const PlanRoutes = router;
