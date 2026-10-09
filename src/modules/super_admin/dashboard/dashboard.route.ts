import express from "express";
import { checkAuth } from "../../../middlewares/checkAuth";
import { Role } from "@prisma/client";
import { AdminDashboardController } from "./dashboard.controller";

const router = express.Router();

router.get(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  AdminDashboardController.getDashboardStats
);

export const AdminDashboardRoutes = router;
