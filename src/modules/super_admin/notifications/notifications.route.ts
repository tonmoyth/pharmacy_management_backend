import express from "express";
import { checkAuth } from "../../../middlewares/checkAuth";
import { Role } from "@prisma/client";
import { AdminNotificationsController } from "./notifications.controller";

const router = express.Router();

router.get(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  AdminNotificationsController.getNotifications
);

router.patch(
  "/:id/read",
  checkAuth(Role.SUPER_ADMIN),
  AdminNotificationsController.markAsRead
);

router.post(
  "/read-all",
  checkAuth(Role.SUPER_ADMIN),
  AdminNotificationsController.markAllAsRead
);

export const AdminNotificationsRoutes = router;
