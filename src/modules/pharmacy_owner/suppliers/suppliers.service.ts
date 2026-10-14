import httpStatus from "http-status";
import { PayMethod, PurchaseStatus, Role } from "@prisma/client";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/queryBuilder";
import {
  supplierFilterableFields,
  supplierPaymentFilterableFields,
  supplierPaymentSearchableFields,
  supplierSearchableFields,
} from "./suppliers.constant";

export interface ISupplierUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface ICreateSupplierPayload {
  name: string;
  phone?: string | null;
  address?: string | null;
  company?: string | null;
}

export interface IUpdateSupplierPayload {
  name?: string;
  phone?: string | null;
  address?: string | null;
  company?: string | null;
  isActive?: boolean;
}

export interface IRecordSupplierPaymentPayload {
  amount: number;
  method: PayMethod;
  paidAt?: string;
  note?: string | null;
  purchaseId?: string | null;
}

/**
 * Retrieve suppliers belonging to the authenticated user's pharmacy.
 * Supports pagination, sorting, search (name, phone, company), and hasDue filter.
 * Role-based response filtering: STAFF never receives dueBalance or financial data.
 */
const getSuppliers = async (
  pharmacyId: string,
  userRole: Role,
  query: Record<string, unknown>
) => {
  const normalizedQuery: Record<string, unknown> = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
  };

  // Extract hasDue before passing to QueryBuilder filter
  const hasDue = query.hasDue;
  delete normalizedQuery.hasDue;

  const supplierQuery = new QueryBuilder(
    prisma.supplier,
    normalizedQuery as any,
    {
      searchableFields: supplierSearchableFields,
      filterableFields: supplierFilterableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate();

  // Strict tenant isolation: always filter by authenticated pharmacyId
  supplierQuery.where({ pharmacyId });

  // Handle hasDue filter: true -> dueBalance > 0, false -> dueBalance <= 0
  if (hasDue === "true" || hasDue === true) {
    supplierQuery.where({ dueBalance: { gt: 0 } });
  } else if (hasDue === "false" || hasDue === false) {
    supplierQuery.where({ dueBalance: { lte: 0 } });
  }

  const result = await supplierQuery.execute();

  // Role-based response filtering:
  // STAFF receives ONLY non-financial fields (id, name, phone, company, address, isActive, createdAt)
  if (userRole === Role.STAFF) {
    const staffFilteredData = result.data.map((s: any) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      company: s.company,
      address: s.address,
      isActive: s.isActive,
      createdAt: s.createdAt,
    }));

    return {
      meta: result.meta,
      data: staffFilteredData,
    };
  }

  // PHARMACY_OWNER and admin roles receive dueBalance and full details
  const ownerData = result.data.map((s: any) => ({
    id: s.id,
    name: s.name,
    phone: s.phone,
    company: s.company,
    address: s.address,
    dueBalance: Number(s.dueBalance),
    isActive: s.isActive,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  return {
    meta: result.meta,
    data: ownerData,
  };
};

/**
 * Create a supplier for the authenticated user's pharmacy.
 * Both PHARMACY_OWNER and STAFF can create a supplier.
 * STAFF does not receive financial details in the response.
 */
const createSupplier = async (
  pharmacyId: string,
  user: ISupplierUserContext,
  payload: ICreateSupplierPayload,
  ip?: string,
  userAgent?: string
) => {
  const supplier = await prisma.supplier.create({
    data: {
      pharmacyId,
      name: payload.name.trim(),
      phone: payload.phone?.trim() || null,
      address: payload.address?.trim() || null,
      company: payload.company?.trim() || null,
      dueBalance: 0,
      isActive: true,
    },
  });

  // Record audit log
  await prisma.auditLog.create({
    data: {
      pharmacyId,
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: "SUPPLIER_CREATED",
      entityType: "Supplier",
      entityId: supplier.id,
      newValue: {
        id: supplier.id,
        name: supplier.name,
        company: supplier.company,
        phone: supplier.phone,
      },
      reason: `Created supplier '${supplier.name}'`,
      ip,
      userAgent,
    },
  });

  if (user.role === Role.STAFF) {
    return {
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      company: supplier.company,
      address: supplier.address,
      isActive: supplier.isActive,
      createdAt: supplier.createdAt,
    };
  }

  return {
    id: supplier.id,
    pharmacyId: supplier.pharmacyId,
    name: supplier.name,
    phone: supplier.phone,
    company: supplier.company,
    address: supplier.address,
    dueBalance: Number(supplier.dueBalance),
    isActive: supplier.isActive,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
};

/**
 * Get supplier details and financial totals (totalPurchase, totalPaid, dueBalance).
 * PHARMACY_OWNER only.
 */
const getSupplierById = async (pharmacyId: string, supplierId: string) => {
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      pharmacyId,
    },
  });

  if (!supplier) {
    throw new AppError(httpStatus.NOT_FOUND, "Supplier not found");
  }

  // Calculate totals from actual related records
  // 1. Total Purchases (non-cancelled)
  // 2. Total Supplier Payments
  // 3. Total Purchase Returns
  const [purchaseAgg, paymentAgg, returnAgg] = await Promise.all([
    prisma.purchase.aggregate({
      _sum: { totalAmount: true },
      where: {
        pharmacyId,
        supplierId,
        status: { not: PurchaseStatus.CANCELLED },
      },
    }),
    prisma.supplierPayment.aggregate({
      _sum: { amount: true },
      where: {
        pharmacyId,
        supplierId,
      },
    }),
    prisma.purchaseReturn.aggregate({
      _sum: { totalAmount: true },
      where: {
        pharmacyId,
        supplierId,
      },
    }),
  ]);

  const totalPurchase = Number(purchaseAgg._sum.totalAmount || 0);
  const totalPaid = Number(paymentAgg._sum.amount || 0);
  const totalReturn = Number(returnAgg._sum.totalAmount || 0);
  // Net Due = Total Purchases - Total Returns - Total Payments
  const calculatedDue =
    Math.round((totalPurchase - totalReturn - totalPaid) * 100) / 100;

  // Sync stored dueBalance if drift is detected
  if (Math.abs(Number(supplier.dueBalance) - calculatedDue) > 0.001) {
    await prisma.supplier.update({
      where: { id: supplierId },
      data: { dueBalance: calculatedDue },
    });
  }

  return {
    id: supplier.id,
    pharmacyId: supplier.pharmacyId,
    name: supplier.name,
    phone: supplier.phone,
    address: supplier.address,
    company: supplier.company,
    isActive: supplier.isActive,
    totalPurchase,
    totalPaid,
    totalReturn,
    dueBalance: calculatedDue,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
};

/**
 * Update supplier details or active status.
 * PHARMACY_OWNER only. Cannot change id or pharmacyId.
 */
const updateSupplier = async (
  pharmacyId: string,
  supplierId: string,
  user: ISupplierUserContext,
  payload: IUpdateSupplierPayload,
  ip?: string,
  userAgent?: string
) => {
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      pharmacyId,
    },
  });

  if (!supplier) {
    throw new AppError(httpStatus.NOT_FOUND, "Supplier not found");
  }

  const updateData: Record<string, unknown> = {};
  if (payload.name !== undefined) updateData.name = payload.name.trim();
  if (payload.phone !== undefined)
    updateData.phone = payload.phone?.trim() || null;
  if (payload.address !== undefined)
    updateData.address = payload.address?.trim() || null;
  if (payload.company !== undefined)
    updateData.company = payload.company?.trim() || null;
  if (payload.isActive !== undefined) updateData.isActive = payload.isActive;

  const updatedSupplier = await prisma.supplier.update({
    where: { id: supplierId },
    data: updateData,
  });

  // Record audit log
  await prisma.auditLog.create({
    data: {
      pharmacyId,
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: "SUPPLIER_UPDATED",
      entityType: "Supplier",
      entityId: supplierId,
      oldValue: {
        name: supplier.name,
        phone: supplier.phone,
        address: supplier.address,
        company: supplier.company,
        isActive: supplier.isActive,
      },
      newValue: {
        name: updatedSupplier.name,
        phone: updatedSupplier.phone,
        address: updatedSupplier.address,
        company: updatedSupplier.company,
        isActive: updatedSupplier.isActive,
      },
      reason: `Updated supplier '${updatedSupplier.name}'`,
      ip,
      userAgent,
    },
  });

  return {
    id: updatedSupplier.id,
    pharmacyId: updatedSupplier.pharmacyId,
    name: updatedSupplier.name,
    phone: updatedSupplier.phone,
    address: updatedSupplier.address,
    company: updatedSupplier.company,
    dueBalance: Number(updatedSupplier.dueBalance),
    isActive: updatedSupplier.isActive,
    createdAt: updatedSupplier.createdAt,
    updatedAt: updatedSupplier.updatedAt,
  };
};

/**
 * Record a payment made to a supplier in an atomic transaction.
 * PHARMACY_OWNER only.
 * Rejects with PAYMENT_EXCEEDS_DUE if payment amount exceeds outstanding due.
 * Pessimistic locking protects against concurrent overpayments.
 */
const recordSupplierPayment = async (
  pharmacyId: string,
  supplierId: string,
  user: ISupplierUserContext,
  payload: IRecordSupplierPaymentPayload,
  ip?: string,
  userAgent?: string
) => {
  const amount = Math.round(Number(payload.amount) * 100) / 100;
  if (isNaN(amount) || amount <= 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Payment amount must be a positive number greater than 0"
    );
  }

  // Pre-check supplier existence and tenant ownership
  const existingSupplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      pharmacyId,
    },
  });

  if (!existingSupplier) {
    throw new AppError(httpStatus.NOT_FOUND, "Supplier not found");
  }

  // If purchaseId is supplied, verify it belongs to the same supplier & pharmacy
  if (payload.purchaseId) {
    const purchase = await prisma.purchase.findFirst({
      where: {
        id: payload.purchaseId,
        pharmacyId,
        supplierId,
      },
    });

    if (!purchase) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Purchase not found or does not belong to this supplier and pharmacy"
      );
    }

    if (purchase.status === PurchaseStatus.CANCELLED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Cannot record payment against a cancelled purchase"
      );
    }

    const purchaseDue = Number(purchase.dueAmount);
    if (amount > purchaseDue) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Payment amount (${amount} BDT) exceeds the outstanding purchase due of ${purchaseDue} BDT`,
        "PAYMENT_EXCEEDS_DUE"
      );
    }
  }

  // Atomic transaction with pessimistic row lock to prevent concurrency race conditions
  const transactionResult = await prisma.$transaction(
    async (tx) => {
      // Row-level lock on the supplier row in PostgreSQL
      await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id = ${supplierId} AND "pharmacyId" = ${pharmacyId} FOR UPDATE`;

      // Re-calculate real outstanding due balance inside the locked transaction
      const [purchaseAgg, paymentAgg, returnAgg] = await Promise.all([
        tx.purchase.aggregate({
          _sum: { totalAmount: true },
          where: {
            pharmacyId,
            supplierId,
            status: { not: PurchaseStatus.CANCELLED },
          },
        }),
        tx.supplierPayment.aggregate({
          _sum: { amount: true },
          where: {
            pharmacyId,
            supplierId,
          },
        }),
        tx.purchaseReturn.aggregate({
          _sum: { totalAmount: true },
          where: {
            pharmacyId,
            supplierId,
          },
        }),
      ]);

      const totalPurchase = Number(purchaseAgg._sum.totalAmount || 0);
      const totalPaid = Number(paymentAgg._sum.amount || 0);
      const totalReturn = Number(returnAgg._sum.totalAmount || 0);
      const currentDue =
        Math.round((totalPurchase - totalReturn - totalPaid) * 100) / 100;

      // Reject if requested payment exceeds current outstanding due
      if (currentDue <= 0 || amount > currentDue) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Payment amount (${amount} BDT) exceeds supplier's current outstanding due (${currentDue} BDT)`,
          "PAYMENT_EXCEEDS_DUE"
        );
      }

      // If purchaseId was provided, re-verify and update purchase within transaction
      if (payload.purchaseId) {
        const purchaseInTx = await tx.purchase.findFirst({
          where: {
            id: payload.purchaseId,
            pharmacyId,
            supplierId,
          },
        });

        if (!purchaseInTx || purchaseInTx.status === PurchaseStatus.CANCELLED) {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            "Purchase is cancelled or no longer valid for payment allocation"
          );
        }

        const currentPurchaseDue = Number(purchaseInTx.dueAmount);
        if (amount > currentPurchaseDue) {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            `Payment amount (${amount} BDT) exceeds the current purchase due of ${currentPurchaseDue} BDT`,
            "PAYMENT_EXCEEDS_DUE"
          );
        }

        await tx.purchase.update({
          where: { id: payload.purchaseId },
          data: {
            paidAmount: { increment: amount },
            dueAmount: { decrement: amount },
          },
        });
      }

      // Create SupplierPayment record
      const payment = await tx.supplierPayment.create({
        data: {
          pharmacyId,
          supplierId,
          purchaseId: payload.purchaseId || null,
          amount,
          method: payload.method,
          paidAt: payload.paidAt ? new Date(payload.paidAt) : new Date(),
          note: payload.note?.trim() || null,
          createdById: user.id,
        },
        include: {
          purchase: {
            select: {
              id: true,
              invoiceNo: true,
              totalAmount: true,
              dueAmount: true,
            },
          },
        },
      });

      // Update cached dueBalance on Supplier model
      const newDueBalance = Math.round((currentDue - amount) * 100) / 100;
      await tx.supplier.update({
        where: { id: supplierId },
        data: { dueBalance: newDueBalance },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "SUPPLIER_PAYMENT_RECORDED",
          entityType: "SupplierPayment",
          entityId: payment.id,
          newValue: {
            paymentId: payment.id,
            supplierId,
            amount,
            method: payload.method,
            purchaseId: payload.purchaseId || null,
            remainingDue: newDueBalance,
          },
          reason: `Recorded payment of BDT ${amount} to supplier (${payload.method})`,
          ip,
          userAgent,
        },
      });

      return {
        payment: {
          id: payment.id,
          pharmacyId: payment.pharmacyId,
          supplierId: payment.supplierId,
          purchaseId: payment.purchaseId,
          purchase: payment.purchase
            ? {
                id: payment.purchase.id,
                invoiceNo: payment.purchase.invoiceNo,
                totalAmount: Number(payment.purchase.totalAmount),
                dueAmount: Number(payment.purchase.dueAmount),
              }
            : null,
          amount: Number(payment.amount),
          method: payment.method,
          paidAt: payment.paidAt,
          note: payment.note,
          createdAt: payment.createdAt,
        },
        financialSummary: {
          totalPurchase,
          totalPaid: Math.round((totalPaid + amount) * 100) / 100,
          totalReturn,
          dueBalance: newDueBalance,
        },
      };
    },
    {
      maxWait: 10000,
      timeout: 20000,
    }
  );

  return transactionResult;
};

/**
 * Return payment history for a supplier.
 * PHARMACY_OWNER only. Scoped to pharmacyId and supplierId.
 */
const getSupplierPayments = async (
  pharmacyId: string,
  supplierId: string,
  query: Record<string, unknown>
) => {
  // Ensure supplier belongs to authenticated pharmacy
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      pharmacyId,
    },
  });

  if (!supplier) {
    throw new AppError(httpStatus.NOT_FOUND, "Supplier not found");
  }

  const normalizedQuery: Record<string, unknown> = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
    sortBy: query.sortBy || "paidAt",
    sortOrder: query.sortOrder || "desc",
  };

  const paymentQuery = new QueryBuilder(
    prisma.supplierPayment,
    normalizedQuery as any,
    {
      searchableFields: supplierPaymentSearchableFields,
      filterableFields: supplierPaymentFilterableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate()
    .include({
      purchase: {
        select: {
          id: true,
          invoiceNo: true,
          purchaseDate: true,
          totalAmount: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    });

  // Strict tenant and supplier scoping
  paymentQuery.where({ pharmacyId, supplierId });

  const result = await paymentQuery.execute();

  const formattedData = result.data.map((p: any) => ({
    id: p.id,
    pharmacyId: p.pharmacyId,
    supplierId: p.supplierId,
    purchaseId: p.purchaseId,
    amount: Number(p.amount),
    method: p.method,
    paidAt: p.paidAt,
    note: p.note,
    createdAt: p.createdAt,
    purchase: p.purchase
      ? {
          id: p.purchase.id,
          invoiceNo: p.purchase.invoiceNo,
          purchaseDate: p.purchase.purchaseDate,
          totalAmount: Number(p.purchase.totalAmount),
        }
      : null,
    createdBy: p.createdBy,
  }));

  return {
    meta: result.meta,
    data: formattedData,
  };
};

/**
 * Return chronological supplier ledger containing:
 * - Purchases (Credit: increases liability / payable)
 * - Purchase Returns (Debit: reduces liability)
 * - Supplier Payments (Debit: reduces liability)
 *
 * Accounting convention:
 * Credit = Amount owed to supplier increases (+)
 * Debit  = Amount owed to supplier decreases (-)
 * Running Balance = Previous Balance + Credit - Debit
 * Closing Balance reconciles exactly with current dueBalance.
 *
 * Full calculation is performed chronologically before applying pagination
 * so running balances are guaranteed to be 100% accurate on all pages.
 */
const getSupplierLedger = async (
  pharmacyId: string,
  supplierId: string,
  query: Record<string, unknown>
) => {
  // Ensure supplier belongs to authenticated pharmacy
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: supplierId,
      pharmacyId,
    },
  });

  if (!supplier) {
    throw new AppError(httpStatus.NOT_FOUND, "Supplier not found");
  }

  // Fetch all balance-affecting transactions for this supplier
  const [purchases, returns, payments] = await Promise.all([
    prisma.purchase.findMany({
      where: {
        pharmacyId,
        supplierId,
        status: { not: PurchaseStatus.CANCELLED },
      },
      select: {
        id: true,
        invoiceNo: true,
        purchaseDate: true,
        totalAmount: true,
        note: true,
        createdAt: true,
      },
    }),
    prisma.purchaseReturn.findMany({
      where: {
        pharmacyId,
        supplierId,
      },
      select: {
        id: true,
        returnNo: true,
        reason: true,
        totalAmount: true,
        note: true,
        createdAt: true,
      },
    }),
    prisma.supplierPayment.findMany({
      where: {
        pharmacyId,
        supplierId,
      },
      select: {
        id: true,
        amount: true,
        method: true,
        paidAt: true,
        note: true,
        createdAt: true,
        purchase: {
          select: {
            id: true,
            invoiceNo: true,
          },
        },
      },
    }),
  ]);

  interface ILedgerRawItem {
    id: string;
    date: Date;
    type: "PURCHASE" | "RETURN" | "PAYMENT";
    reference: string;
    description: string;
    debit: number;
    credit: number;
    amount: number;
    timestamp: number;
    priority: number;
    runningBalance?: number;
  }

  const rawEntries: ILedgerRawItem[] = [];

  // Purchases: Credit liability
  for (const p of purchases) {
    const d = new Date(p.purchaseDate);
    const amt = Number(p.totalAmount);
    rawEntries.push({
      id: p.id,
      date: d,
      type: "PURCHASE",
      reference: p.invoiceNo,
      description: p.note || `Purchase invoice #${p.invoiceNo}`,
      debit: 0,
      credit: amt,
      amount: amt,
      timestamp: d.getTime(),
      priority: 1, // Purchase first if same timestamp
    });
  }

  // Purchase Returns: Debit liability
  for (const r of returns) {
    const d = new Date(r.createdAt);
    const amt = Number(r.totalAmount);
    rawEntries.push({
      id: r.id,
      date: d,
      type: "RETURN",
      reference: r.returnNo,
      description: r.note || `Purchase return #${r.returnNo} (${r.reason})`,
      debit: amt,
      credit: 0,
      amount: amt,
      timestamp: d.getTime(),
      priority: 2, // Return second
    });
  }

  // Payments: Debit liability
  for (const pay of payments) {
    const d = new Date(pay.paidAt || pay.createdAt);
    const amt = Number(pay.amount);
    const ref = pay.purchase?.invoiceNo
      ? `Invoice #${pay.purchase.invoiceNo}`
      : pay.method;
    rawEntries.push({
      id: pay.id,
      date: d,
      type: "PAYMENT",
      reference: ref,
      description: pay.note || `Supplier payment via ${pay.method}`,
      debit: amt,
      credit: 0,
      amount: amt,
      timestamp: d.getTime(),
      priority: 3, // Payment third
    });
  }

  // Deterministic chronological sorting:
  // 1. Timestamp ascending
  // 2. Priority (Purchases -> Returns -> Payments)
  // 3. ID ascending (deterministic tiebreaker)
  rawEntries.sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      a.priority - b.priority ||
      a.id.localeCompare(b.id)
  );

  // Compute cumulative running balance across the full history
  let runningBalance = 0;
  let totalPurchase = 0;
  let totalReturn = 0;
  let totalPaid = 0;

  for (const entry of rawEntries) {
    totalPurchase += entry.credit;
    totalReturn += entry.type === "RETURN" ? entry.debit : 0;
    totalPaid += entry.type === "PAYMENT" ? entry.debit : 0;

    runningBalance =
      Math.round((runningBalance + entry.credit - entry.debit) * 100) / 100;
    entry.runningBalance = runningBalance;
  }

  const closingBalance = runningBalance;

  // Pagination on chronological ledger entries
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  const total = rawEntries.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const skip = (page - 1) * limit;
  const paginatedEntries = rawEntries.slice(skip, skip + limit);

  const formattedData = paginatedEntries.map(
    ({ timestamp, priority, ...item }) => item
  );

  return {
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
    summary: {
      totalPurchase: Math.round(totalPurchase * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      closingBalance,
    },
    data: formattedData,
  };
};

export const SupplierService = {
  getSuppliers,
  createSupplier,
  getSupplierById,
  updateSupplier,
  recordSupplierPayment,
  getSupplierPayments,
  getSupplierLedger,
};
