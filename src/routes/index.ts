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
import { PharmacyProfileSettingRoutes } from "../modules/pharmacy_owner/profile_setiing/profile_setting.route";
import { OwnerStaffRoutes } from "../modules/pharmacy_owner/staff_management/staff.route";
import { AdminDashboardRoutes } from "../modules/super_admin/dashboard/dashboard.route";
import { AdminReportsRoutes } from "../modules/super_admin/reports/reports.route";
import { AdminAuditLogsRoutes } from "../modules/super_admin/audit_logs/audit_logs.route";
import { AdminNotificationsRoutes } from "../modules/super_admin/notifications/notifications.route";
import { CategoryRoutes } from "../modules/pharmacy_owner/category/category.route";
import { MedicinesManagementRoutes } from "../modules/pharmacy_owner/medicines_management/medicines_management.route";
import { ExcelCsvImportRoutes } from "../modules/pharmacy_owner/excel_csv_import/excel_csv_import.route";
import { SupplierRoutes } from "../modules/pharmacy_owner/suppliers/suppliers.route";
import { PurchaseRoutes } from "../modules/pharmacy_owner/purchases/purchases.route";
import { PurchaseReturnRoutes } from "../modules/pharmacy_owner/purchase_returns/purchase_returns.route";
import { SalesRoutes } from "../modules/pharmacy_owner/sales/sales.route";
import { SalesReturnRoutes } from "../modules/pharmacy_owner/sales_returns/sales_returns.route";

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
  },
  {
    path: "/pharmacy",
    route: PharmacyProfileSettingRoutes,
  },
  {
    path: "/pharmacy/staff",
    route: OwnerStaffRoutes,
  },
  {
    path: "/pharmacy/categories",
    route: CategoryRoutes,
  },
  {
    path: "/pharmacy/medicines",
    route: MedicinesManagementRoutes,
  },

  {
    path: "/pharmacy/imports",
    route: ExcelCsvImportRoutes,
  },
  {
    path: "/pharmacy/suppliers",
    route: SupplierRoutes,
  },
  {
    path: "/suppliers",
    route: SupplierRoutes,
  },
  {
    path: "/pharmacy/purchases",
    route: PurchaseRoutes,
  },
  {
    path: "/purchases",
    route: PurchaseRoutes,
  },
  {
    path: "/pharmacy/purchase-returns",
    route: PurchaseReturnRoutes,
  },
  {
    path: "/purchase-returns",
    route: PurchaseReturnRoutes,
  },
  {
    path: "/pharmacy/sales",
    route: SalesRoutes,
  },
  {
    path: "/sales",
    route: SalesRoutes,
  },
  {
    path: "/pharmacy/sales-returns",
    route: SalesReturnRoutes,
  },
  {
    path: "/sales-returns",
    route: SalesReturnRoutes,
  },
  {
    path: "/admin/dashboard",
    route: AdminDashboardRoutes,
  },
  {
    path: "/admin/reports",
    route: AdminReportsRoutes,
  },
  {
    path: "/admin/audit-logs",
    route: AdminAuditLogsRoutes,
  },
  {
    path: "/admin/notifications",
    route: AdminNotificationsRoutes,
  }
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
