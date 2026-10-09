import express from "express";
import { checkAuth } from "../../../middlewares/checkAuth";
import { Role } from "@prisma/client";
import { AdminAuditLogsController } from "./audit_logs.controller";

const router = express.Router();

router.get(
  "/",
  checkAuth(Role.SUPER_ADMIN),
  AdminAuditLogsController.getAuditLogs
);

export const AdminAuditLogsRoutes = router;
