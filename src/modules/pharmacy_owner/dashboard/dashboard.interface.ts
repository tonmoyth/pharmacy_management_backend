import { Role } from "@prisma/client";

export interface IDashboardUserContext {
  id: string;
  name: string;
  role: Role;
  pharmacyId?: string | null;
}

export interface ISalesMetric {
  totalAmount: number;
  count: number;
}

export interface IPurchasesMetric {
  totalAmount: number;
  count: number;
}

export interface IMedicinesMetric {
  total: number;
  active: number;
  totalStockPieces: number;
}

export interface IInventoryMetric {
  totalStockPieces: number;
  lowStockCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  expiringThresholdDays: number;
}

export interface IDuesMetric {
  customerDue: number;
  supplierDue: number;
}

export interface IExpensesMetric {
  totalAmount: number;
  count: number;
}

export interface IEstimatedProfitMetric {
  period: "current_month";
  startDate: string;
  endDate: string;
  estimatedGrossProfit: number;
  totalNetSales: number;
  totalCostOfGoodsSold: number;
}

export interface IRecentReturnItem {
  id: string;
  returnNo: string;
  returnType: "SALE_RETURN" | "PURCHASE_RETURN";
  referenceNo: string | null;
  returnDate: Date;
  amount: number;
  reason: string | null;
  supplierName?: string | null;
}

export interface ILowStockMedicineItem {
  id: string;
  name: string;
  genericName: string | null;
  company: string | null;
  minStockLevel: number;
  currentStock: number;
}

export interface IOwnerDashboardResponse {
  role: "PHARMACY_OWNER";
  sales: {
    today: ISalesMetric;
    currentMonth: ISalesMetric;
  };
  purchases: {
    today: IPurchasesMetric;
    currentMonth: IPurchasesMetric;
  };
  medicines: IMedicinesMetric;
  inventory: IInventoryMetric;
  dues: IDuesMetric;
  expenses: {
    today: IExpensesMetric;
  };
  profit: IEstimatedProfitMetric;
  recentReturns: IRecentReturnItem[];
}

export interface IEmployeeDashboardResponse {
  role: "CASHIER" | "STAFF";
  mySalesToday: ISalesMetric;
  lowStock: {
    count: number;
    items: ILowStockMedicineItem[];
  };
}

export type IDashboardResponse = IOwnerDashboardResponse | IEmployeeDashboardResponse;
