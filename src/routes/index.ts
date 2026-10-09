import express from "express";


import { AuthRoutes } from "../modules/auth/auth.route";
import { PlanRoutes } from "../modules/super_admin/plan/plan.route";
import { AdminApplicationRoutes } from "../modules/super_admin/application/application.route";
import { AdminPharmacyRoutes } from "../modules/super_admin/pharmacies/pharmacy.route";
import { PublicPlanRoutes } from "../modules/public/plan/plan.public.route";
import { PaymentSettingRoutes } from "../modules/super_admin/payment_setting/payment_setting.route";
import { PublicPaymentInfoRoutes } from "../modules/public/payment_info/payment_info.route";
import { PublicApplicationRoutes } from "../modules/public/application/application.public.route";
import { AdminPaymentManagementRoutes } from "../modules/super_admin/payment_management/payment_management.route";
import { OwnerSubscriptionRoutes } from "../modules/pharmacy_owner/subscription/subscription.route";

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
    path: "/admin/applications",
    route: AdminApplicationRoutes,
  },
  {
    path: "/admin/pharmacies",
    route: AdminPharmacyRoutes,
  },
  {
    path: "/public/plans",
    route: PublicPlanRoutes,
  },
  {
    path: "/admin/settings",
    route: PaymentSettingRoutes,
  },
  {
    path: "/public/payment-info",
    route: PublicPaymentInfoRoutes,
  },
  {
    path: "/public/applications",
    route: PublicApplicationRoutes,
  },
  {
    path: "/admin/payments",
    route: AdminPaymentManagementRoutes,
  },
  {
    path: "/pharmacy/owner/subscription",
    route: OwnerSubscriptionRoutes,
  }
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
