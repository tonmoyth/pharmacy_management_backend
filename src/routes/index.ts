import express from "express";


import { AuthRoutes } from "../modules/auth/auth.route";
import { PlanRoutes } from "../modules/super_admin/plan/plan.route";
import { PublicPlanRoutes } from "../modules/public/plan/plan.public.route";

const router = express.Router();

const moduleRoutes = [
  {
    path: "/auth",
    route: AuthRoutes,
  },
  {
    path: "/admin/plans",
    route: PlanRoutes,
  },
  {
    path: "/public/plans",
    route: PublicPlanRoutes,
  }
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
