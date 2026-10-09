import express from "express";
import { checkAuth } from "../../../middlewares/checkAuth";
import { Role } from "@prisma/client";
import { AdminReportsController } from "./reports.controller";

const router = express.Router();

router.get(
  "/revenue",
  checkAuth(Role.SUPER_ADMIN),
  AdminReportsController.getRevenueReport
);

router.get(
  "/subscriptions",
  checkAuth(Role.SUPER_ADMIN),
  AdminReportsController.getSubscriptionsReport
);

router.get(
  "/pharmacy-growth",
  checkAuth(Role.SUPER_ADMIN),
  AdminReportsController.getPharmacyGrowthReport
);

export const AdminReportsRoutes = router;
