import httpStatus from "http-status";
import {
  MedicineStatus,
  PharmacyStatus,
  PurchaseStatus,
  Role,
  SaleStatus,
} from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import AppError from "../../../errors/AppError";
import {
  getDhakaBoundaries,
  round2,
} from "./dashboard.helper";
import {
  IDashboardResponse,
  IDashboardUserContext,
  IEmployeeDashboardResponse,
  ILowStockMedicineItem,
  IOwnerDashboardResponse,
  IRecentReturnItem,
} from "./dashboard.interface";

/**
 * Validates that the pharmacy exists and has ACTIVE status.
 */
const validatePharmacyActive = async (pharmacyId: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

  if (!pharmacy) {
    throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  }

  if (pharmacy.status !== PharmacyStatus.ACTIVE) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      `Pharmacy is not active (Status: ${pharmacy.status}). Dashboard access is disabled.`
    );
  }

  return pharmacy;
};

/**
 * Cashier and Staff Dashboard Service.
 * Restricted to employee's own sales today and pharmacy-wide low stock.
 * Never exposes owner financial metrics, profit, expenses, or cost prices.
 */
const getEmployeeDashboard = async (
  pharmacyId: string,
  user: IDashboardUserContext,
  refDate: Date = new Date()
): Promise<IEmployeeDashboardResponse> => {
  const boundaries = getDhakaBoundaries(refDate);

  // 1. Employee's own sales today (non-cancelled, Asia/Dhaka boundaries)
  const mySalesTodayResult = await prisma.sale.aggregate({
    where: {
      pharmacyId,
      createdById: user.id,
      status: { not: SaleStatus.CANCELLED },
      soldAt: {
        gte: boundaries.startOfTodayUtc,
        lt: boundaries.startOfTomorrowUtc,
      },
    },
    _sum: {
      totalAmount: true,
    },
    _count: {
      id: true,
    },
  });

  // 2. Pharmacy Low Stock (non-expired, sellable stock < configured minStockLevel)
  const lowStockMedicines = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      genericName: string | null;
      company: string | null;
      minStockLevel: number;
      currentStock: number;
    }>
  >`
    SELECT 
      m.id, 
      m.name, 
      m."genericName", 
      m.company, 
      m."minStockLevel", 
      COALESCE(SUM(b."availableQty"), 0)::integer AS "currentStock"
    FROM "Medicine" m
    LEFT JOIN "MedicineBatch" b
      ON b."medicineId" = m.id
      AND b."expiryDate" >= ${boundaries.todayDate}
      AND b."availableQty" > 0
      AND b."pharmacyId" = ${pharmacyId}
    WHERE m."pharmacyId" = ${pharmacyId}
      AND m.status = 'ACTIVE'
      AND m."minStockLevel" > 0
    GROUP BY m.id, m.name, m."genericName", m.company, m."minStockLevel"
    HAVING COALESCE(SUM(b."availableQty"), 0) < m."minStockLevel"
    ORDER BY m.name ASC
  `;

  const items: ILowStockMedicineItem[] = lowStockMedicines.map((m) => ({
    id: m.id,
    name: m.name,
    genericName: m.genericName,
    company: m.company,
    minStockLevel: m.minStockLevel,
    currentStock: Number(m.currentStock),
  }));

  return {
    role: user.role as "CASHIER" | "STAFF",
    mySalesToday: {
      totalAmount: round2(Number(mySalesTodayResult._sum.totalAmount || 0)),
      count: mySalesTodayResult._count.id,
    },
    lowStock: {
      count: items.length,
      items,
    },
  };
};

/**
 * Pharmacy Owner Dashboard Service.
 * Full pharmacy metrics with tenant isolation and strict Asia/Dhaka boundaries.
 */
const getOwnerDashboard = async (
  pharmacyId: string,
  refDate: Date = new Date()
): Promise<IOwnerDashboardResponse> => {
  const boundaries = getDhakaBoundaries(refDate);

  const [
    salesTodayResult,
    salesMonthResult,
    purchasesTodayResult,
    purchasesMonthResult,
    totalMedicinesCount,
    activeMedicinesCount,
    totalStockResult,
    lowStockMedicines,
    expiringSoonCount,
    expiredCount,
    customerDueResult,
    supplierDueResult,
    todayExpenseResult,
    monthSalesForProfit,
    recentSalesReturns,
    recentPurchaseReturns,
  ] = await Promise.all([
    // A. Sales Today (non-cancelled, Asia/Dhaka day boundaries)
    prisma.sale.aggregate({
      where: {
        pharmacyId,
        status: { not: SaleStatus.CANCELLED },
        soldAt: {
          gte: boundaries.startOfTodayUtc,
          lt: boundaries.startOfTomorrowUtc,
        },
      },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),

    // B. Sales Current Month (non-cancelled, Asia/Dhaka month boundaries)
    prisma.sale.aggregate({
      where: {
        pharmacyId,
        status: { not: SaleStatus.CANCELLED },
        soldAt: {
          gte: boundaries.startOfMonthUtc,
          lt: boundaries.startOfNextMonthUtc,
        },
      },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),

    // C. Purchases Today (non-cancelled, Asia/Dhaka @db.Date)
    prisma.purchase.aggregate({
      where: {
        pharmacyId,
        status: { not: PurchaseStatus.CANCELLED },
        purchaseDate: {
          gte: boundaries.todayDate,
          lte: boundaries.todayDate,
        },
      },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),

    // D. Purchases Current Month (non-cancelled, Asia/Dhaka @db.Date)
    prisma.purchase.aggregate({
      where: {
        pharmacyId,
        status: { not: PurchaseStatus.CANCELLED },
        purchaseDate: {
          gte: boundaries.startOfMonthDate,
          lte: boundaries.endOfMonthDate,
        },
      },
      _sum: { totalAmount: true },
      _count: { id: true },
    }),

    // E. Total Registered Distinct Medicines
    prisma.medicine.count({
      where: { pharmacyId },
    }),

    // E2. Active Distinct Medicines
    prisma.medicine.count({
      where: { pharmacyId, status: MedicineStatus.ACTIVE },
    }),

    // F. Total Available Sellable Stock in base pieces (non-expired, availableQty > 0)
    prisma.medicineBatch.aggregate({
      where: {
        pharmacyId,
        availableQty: { gt: 0 },
        expiryDate: { gte: boundaries.todayDate },
      },
      _sum: { availableQty: true },
    }),

    // G. Low Stock Medicines (active medicines where non-expired stock < minStockLevel)
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT m.id
      FROM "Medicine" m
      LEFT JOIN "MedicineBatch" b
        ON b."medicineId" = m.id
        AND b."expiryDate" >= ${boundaries.todayDate}
        AND b."availableQty" > 0
        AND b."pharmacyId" = ${pharmacyId}
      WHERE m."pharmacyId" = ${pharmacyId}
        AND m.status = 'ACTIVE'
        AND m."minStockLevel" > 0
      GROUP BY m.id, m."minStockLevel"
      HAVING COALESCE(SUM(b."availableQty"), 0) < m."minStockLevel"
    `,

    // H. Batches Expiring Soon (availableQty > 0, expiring within 30 days)
    prisma.medicineBatch.count({
      where: {
        pharmacyId,
        availableQty: { gt: 0 },
        expiryDate: {
          gte: boundaries.todayDate,
          lte: boundaries.expiringThresholdDate,
        },
      },
    }),

    // I. Expired Batches in stock (availableQty > 0, expiryDate < today)
    prisma.medicineBatch.count({
      where: {
        pharmacyId,
        availableQty: { gt: 0 },
        expiryDate: { lt: boundaries.todayDate },
      },
    }),

    // J. Customer Due Balance total (active customers, dueBalance > 0)
    prisma.customer.aggregate({
      where: {
        pharmacyId,
        isActive: true,
        dueBalance: { gt: 0 },
      },
      _sum: { dueBalance: true },
    }),

    // K. Supplier Due Balance total (active suppliers, dueBalance > 0)
    prisma.supplier.aggregate({
      where: {
        pharmacyId,
        isActive: true,
        dueBalance: { gt: 0 },
      },
      _sum: { dueBalance: true },
    }),

    // L. Today's Expense (non-deleted, Asia/Dhaka day boundaries)
    prisma.expense.aggregate({
      where: {
        pharmacyId,
        deletedAt: null,
        expenseDate: {
          gte: boundaries.todayDate,
          lte: boundaries.todayDate,
        },
      },
      _sum: { amount: true },
      _count: { id: true },
    }),

    // M. Sales data for Estimated Profit calculation (current month, non-cancelled)
    prisma.sale.findMany({
      where: {
        pharmacyId,
        status: { not: SaleStatus.CANCELLED },
        soldAt: {
          gte: boundaries.startOfMonthUtc,
          lt: boundaries.startOfNextMonthUtc,
        },
      },
      select: {
        id: true,
        totalAmount: true,
        items: {
          select: {
            id: true,
            quantityPieces: true,
            returnedQtyPieces: true,
            costPricePerPiece: true,
          },
        },
        returns: {
          select: {
            refundAmount: true,
          },
        },
      },
    }),

    // N1. Recent Sales Returns
    prisma.saleReturn.findMany({
      where: { pharmacyId },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        sale: {
          select: { invoiceNo: true },
        },
      },
    }),

    // N2. Recent Purchase Returns
    prisma.purchaseReturn.findMany({
      where: { pharmacyId },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        purchase: {
          select: { invoiceNo: true },
        },
        supplier: {
          select: { name: true },
        },
      },
    }),
  ]);

  // Calculate estimated gross profit for the current month
  let totalNetSales = 0;
  let totalCostOfGoodsSold = 0;

  for (const sale of monthSalesForProfit) {
    const returnRefundSum = sale.returns.reduce(
      (sum, r) => sum + Number(r.refundAmount),
      0
    );
    const netSaleRevenue = Math.max(0, Number(sale.totalAmount) - returnRefundSum);
    totalNetSales += netSaleRevenue;

    for (const item of sale.items) {
      const netPieces = Math.max(0, item.quantityPieces - item.returnedQtyPieces);
      const cost = netPieces * Number(item.costPricePerPiece);
      totalCostOfGoodsSold += cost;
    }
  }

  totalNetSales = round2(totalNetSales);
  totalCostOfGoodsSold = round2(totalCostOfGoodsSold);
  const estimatedGrossProfit = round2(totalNetSales - totalCostOfGoodsSold);

  // Combine and sort recent returns
  const combinedReturns: IRecentReturnItem[] = [
    ...recentSalesReturns.map((sr) => ({
      id: sr.id,
      returnNo: sr.returnNo,
      returnType: "SALE_RETURN" as const,
      referenceNo: sr.sale?.invoiceNo || null,
      returnDate: sr.createdAt,
      amount: round2(Number(sr.refundAmount)),
      reason: sr.reason,
    })),
    ...recentPurchaseReturns.map((pr) => ({
      id: pr.id,
      returnNo: pr.returnNo,
      returnType: "PURCHASE_RETURN" as const,
      referenceNo: pr.purchase?.invoiceNo || null,
      returnDate: pr.createdAt,
      amount: round2(Number(pr.totalAmount)),
      reason: pr.reason,
      supplierName: pr.supplier?.name || null,
    })),
  ]
    .sort(
      (a, b) => new Date(b.returnDate).getTime() - new Date(a.returnDate).getTime()
    )
    .slice(0, 5);

  const totalStockPieces = Number(totalStockResult._sum.availableQty || 0);

  return {
    role: "PHARMACY_OWNER",
    sales: {
      today: {
        totalAmount: round2(Number(salesTodayResult._sum.totalAmount || 0)),
        count: salesTodayResult._count.id,
      },
      currentMonth: {
        totalAmount: round2(Number(salesMonthResult._sum.totalAmount || 0)),
        count: salesMonthResult._count.id,
      },
    },
    purchases: {
      today: {
        totalAmount: round2(Number(purchasesTodayResult._sum.totalAmount || 0)),
        count: purchasesTodayResult._count.id,
      },
      currentMonth: {
        totalAmount: round2(Number(purchasesMonthResult._sum.totalAmount || 0)),
        count: purchasesMonthResult._count.id,
      },
    },
    medicines: {
      total: totalMedicinesCount,
      active: activeMedicinesCount,
      totalStockPieces,
    },
    inventory: {
      totalStockPieces,
      lowStockCount: lowStockMedicines.length,
      expiringSoonCount,
      expiredCount,
      expiringThresholdDays: 30,
    },
    dues: {
      customerDue: round2(Number(customerDueResult._sum.dueBalance || 0)),
      supplierDue: round2(Number(supplierDueResult._sum.dueBalance || 0)),
    },
    expenses: {
      today: {
        totalAmount: round2(Number(todayExpenseResult._sum.amount || 0)),
        count: todayExpenseResult._count.id,
      },
    },
    profit: {
      period: "current_month",
      startDate: boundaries.monthStartDateString,
      endDate: boundaries.monthEndDateString,
      estimatedGrossProfit,
      totalNetSales,
      totalCostOfGoodsSold,
    },
    recentReturns: combinedReturns,
  };
};

/**
 * Main entry point for the Dashboard API.
 * Dispatches to role-appropriate sub-service.
 */
const getDashboard = async (
  pharmacyId: string,
  user: IDashboardUserContext,
  refDate: Date = new Date()
): Promise<IDashboardResponse> => {
  await validatePharmacyActive(pharmacyId);

  if (user.role === Role.PHARMACY_OWNER) {
    return getOwnerDashboard(pharmacyId, refDate);
  }

  if (user.role === Role.CASHIER || user.role === Role.STAFF) {
    return getEmployeeDashboard(pharmacyId, user, refDate);
  }

  throw new AppError(
    httpStatus.FORBIDDEN,
    "Forbidden. You are not allowed to access this dashboard."
  );
};

export const DashboardService = {
  getDashboard,
  getOwnerDashboard,
  getEmployeeDashboard,
  validatePharmacyActive,
};
