import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import { DashboardController } from "./dashboard.controller";

const router = express.Router();

/**
 * Role-based Pharmacy Dashboard API
 * - PHARMACY_OWNER: Full financial, inventory, sales, purchases, and dues metrics.
 * - CASHIER: Own sales today and pharmacy-wide low stock.
 * - STAFF: Own sales today and pharmacy-wide low stock.
 */
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.CASHIER, Role.STAFF),
  DashboardController.getDashboard
);

export const DashboardRoutes = router;
