import express from "express";
import { AdminApplicationController } from "./application.controller";

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

export const AdminApplicationRoutes = router;
