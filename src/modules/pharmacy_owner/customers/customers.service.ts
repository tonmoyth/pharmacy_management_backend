import httpStatus from "http-status";
import { PayMethod, PharmacyStatus, Role, SaleStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import AppError from "../../../errors/AppError";
import { QueryBuilder } from "../../../utils/queryBuilder";
import {
  CUSTOMER_ERROR_CODES,
  customerFilterableFields,
  customerPaymentFilterableFields,
  customerSalesFilterableFields,
  customerSalesSearchableFields,
  customerSearchableFields,
} from "./customers.constant";
import {
  ICreateCustomerPayload,
  ICreateDuePaymentPayload,
  ICustomerLedgerEntry,
  ICustomerResponse,
  ICustomerUserContext,
  IDuePaymentAllocationResult,
  IDuePaymentResult,
  IUpdateCustomerPayload,
} from "./customers.interface";

const round2 = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

/**
 * Validates that the pharmacy exists and has ACTIVE status.
 */
const validatePharmacyActive = async (pharmacyId: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
  });

  if (!pharmacy) {
    throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  }

  if (pharmacy.status !== PharmacyStatus.ACTIVE) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Pharmacy account is suspended or inactive"
    );
  }

  return pharmacy;
};

/**
 * List customers with search, hasDue filter, pagination, and financial totals.
 */
const getCustomers = async (
  pharmacyId: string,
  query: Record<string, unknown>
) => {
  await validatePharmacyActive(pharmacyId);

  const normalizedQuery: Record<string, unknown> = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
  };

  const hasDue = query.hasDue;
  delete normalizedQuery.hasDue;
  delete normalizedQuery.search;

  const customerQuery = new QueryBuilder(
    prisma.customer,
    normalizedQuery as any,
    {
      searchableFields: customerSearchableFields,
      filterableFields: customerFilterableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate();

  customerQuery.where({ pharmacyId });

  if (hasDue === "true" || hasDue === true) {
    customerQuery.where({ dueBalance: { gt: 0 } });
  } else if (hasDue === "false" || hasDue === false) {
    customerQuery.where({ dueBalance: { lte: 0 } });
  }

  const result = await customerQuery.execute();
  const customerIds = result.data.map((c: any) => c.id);

  if (customerIds.length === 0) {
    return {
      meta: result.meta,
      data: [],
    };
  }

  // Efficient batch aggregation to calculate totalPurchase and totalPaid without N+1 queries
  const [salesAgg, duePaymentsAgg] = await Promise.all([
    prisma.sale.groupBy({
      by: ["customerId"],
      _sum: { totalAmount: true, paidAmount: true },
      where: {
        pharmacyId,
        customerId: { in: customerIds },
        status: { not: SaleStatus.CANCELLED },
      },
    }),
    prisma.duePayment.groupBy({
      by: ["customerId"],
      _sum: { amount: true },
      where: {
        pharmacyId,
        customerId: { in: customerIds },
      },
    }),
  ]);

  const salesMap = new Map<string, { totalAmount: number; paidAmount: number }>();
  for (const s of salesAgg) {
    if (s.customerId) {
      salesMap.set(s.customerId, {
        totalAmount: Number(s._sum.totalAmount || 0),
        paidAmount: Number(s._sum.paidAmount || 0),
      });
    }
  }

  const duePaymentMap = new Map<string, number>();
  for (const dp of duePaymentsAgg) {
    if (dp.customerId) {
      duePaymentMap.set(dp.customerId, Number(dp._sum.amount || 0));
    }
  }

  const formattedData: ICustomerResponse[] = result.data.map((c: any) => {
    const saleData = salesMap.get(c.id) || { totalAmount: 0, paidAmount: 0 };
    const duePaid = duePaymentMap.get(c.id) || 0;

    const totalPurchase = round2(saleData.totalAmount);
    const totalPaid = round2(saleData.paidAmount + duePaid);
    const dueBalance = round2(Number(c.dueBalance));
    const creditLimit = c.creditLimit !== null ? round2(Number(c.creditLimit)) : null;

    return {
      id: c.id,
      pharmacyId: c.pharmacyId,
      name: c.name,
      phone: c.phone,
      address: c.address,
      isActive: c.isActive,
      totalPurchase,
      totalPaid,
      dueBalance,
      creditLimit,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });

  return {
    meta: result.meta,
    data: formattedData,
  };
};

/**
 * Create a new customer with pharmacy-scoped phone uniqueness.
 */
const createCustomer = async (
  pharmacyId: string,
  user: ICustomerUserContext,
  payload: ICreateCustomerPayload,
  ip?: string,
  userAgent?: string
): Promise<ICustomerResponse> => {
  await validatePharmacyActive(pharmacyId);

  const trimmedName = payload.name.trim();
  const trimmedPhone = payload.phone?.trim() || null;
  const trimmedAddress = payload.address?.trim() || null;
  const creditLimit =
    payload.creditLimit !== undefined && payload.creditLimit !== null
      ? round2(payload.creditLimit)
      : null;

  // Check phone uniqueness within this pharmacy
  if (trimmedPhone) {
    const existing = await prisma.customer.findFirst({
      where: {
        pharmacyId,
        phone: trimmedPhone,
      },
    });

    if (existing) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `A customer with phone number '${trimmedPhone}' already exists in your pharmacy.`,
        CUSTOMER_ERROR_CODES.PHONE_ALREADY_EXISTS
      );
    }
  }

  try {
    const customer = await prisma.customer.create({
      data: {
        pharmacyId,
        name: trimmedName,
        phone: trimmedPhone,
        address: trimmedAddress,
        creditLimit: creditLimit !== null ? creditLimit : null,
        dueBalance: 0,
        isActive: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        pharmacyId,
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: "CUSTOMER_CREATED",
        entityType: "Customer",
        entityId: customer.id,
        newValue: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          creditLimit,
        },
        reason: `Created customer '${customer.name}'`,
        ip,
        userAgent,
      },
    });

    return {
      id: customer.id,
      pharmacyId: customer.pharmacyId,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      isActive: customer.isActive,
      totalPurchase: 0,
      totalPaid: 0,
      dueBalance: 0,
      creditLimit,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  } catch (error: any) {
    if (error.code === "P2002") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `A customer with phone number '${trimmedPhone}' already exists in your pharmacy.`,
        CUSTOMER_ERROR_CODES.PHONE_ALREADY_EXISTS
      );
    }
    throw error;
  }
};

/**
 * Get customer details by ID with accurate financial totals.
 */
const getCustomerById = async (
  pharmacyId: string,
  customerId: string
): Promise<ICustomerResponse> => {
  await validatePharmacyActive(pharmacyId);

  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      pharmacyId,
    },
  });

  if (!customer) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Customer not found",
      CUSTOMER_ERROR_CODES.CUSTOMER_NOT_FOUND
    );
  }

  const [salesAgg, duePaymentsAgg] = await Promise.all([
    prisma.sale.aggregate({
      _sum: { totalAmount: true, paidAmount: true },
      where: {
        pharmacyId,
        customerId,
        status: { not: SaleStatus.CANCELLED },
      },
    }),
    prisma.duePayment.aggregate({
      _sum: { amount: true },
      where: {
        pharmacyId,
        customerId,
      },
    }),
  ]);

  const saleTotal = Number(salesAgg._sum.totalAmount || 0);
  const salePaid = Number(salesAgg._sum.paidAmount || 0);
  const duePaid = Number(duePaymentsAgg._sum.amount || 0);

  const totalPurchase = round2(saleTotal);
  const totalPaid = round2(salePaid + duePaid);
  const dueBalance = round2(Number(customer.dueBalance));
  const creditLimit =
    customer.creditLimit !== null ? round2(Number(customer.creditLimit)) : null;

  return {
    id: customer.id,
    pharmacyId: customer.pharmacyId,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    isActive: customer.isActive,
    totalPurchase,
    totalPaid,
    dueBalance,
    creditLimit,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
};

/**
 * Update customer details.
 */
const updateCustomer = async (
  pharmacyId: string,
  user: ICustomerUserContext,
  customerId: string,
  payload: IUpdateCustomerPayload,
  ip?: string,
  userAgent?: string
): Promise<ICustomerResponse> => {
  await validatePharmacyActive(pharmacyId);

  const existingCustomer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      pharmacyId,
    },
  });

  if (!existingCustomer) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Customer not found",
      CUSTOMER_ERROR_CODES.CUSTOMER_NOT_FOUND
    );
  }

  const updateData: Record<string, any> = {};

  if (payload.name !== undefined) {
    updateData.name = payload.name.trim();
  }

  if (payload.address !== undefined) {
    updateData.address = payload.address?.trim() || null;
  }

  if (payload.creditLimit !== undefined) {
    updateData.creditLimit =
      payload.creditLimit !== null ? round2(payload.creditLimit) : null;
  }

  if (payload.isActive !== undefined) {
    updateData.isActive = payload.isActive;
  }

  if (payload.phone !== undefined) {
    const trimmedPhone = payload.phone?.trim() || null;
    if (trimmedPhone && trimmedPhone !== existingCustomer.phone) {
      const phoneConflict = await prisma.customer.findFirst({
        where: {
          pharmacyId,
          phone: trimmedPhone,
          id: { not: customerId },
        },
      });

      if (phoneConflict) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `A customer with phone number '${trimmedPhone}' already exists in your pharmacy.`,
          CUSTOMER_ERROR_CODES.PHONE_ALREADY_EXISTS
        );
      }
    }
    updateData.phone = trimmedPhone;
  }

  try {
    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: updateData,
    });

    await prisma.auditLog.create({
      data: {
        pharmacyId,
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: "CUSTOMER_UPDATED",
        entityType: "Customer",
        entityId: updated.id,
        oldValue: {
          name: existingCustomer.name,
          phone: existingCustomer.phone,
          address: existingCustomer.address,
          creditLimit: existingCustomer.creditLimit,
          isActive: existingCustomer.isActive,
        },
        newValue: updateData,
        reason: `Updated customer '${updated.name}'`,
        ip,
        userAgent,
      },
    });

    return await getCustomerById(pharmacyId, customerId);
  } catch (error: any) {
    if (error.code === "P2002") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `A customer with this phone number already exists in your pharmacy.`,
        CUSTOMER_ERROR_CODES.PHONE_ALREADY_EXISTS
      );
    }
    throw error;
  }
};

/**
 * Get customer sales history with role-based restriction:
 * - OWN (Pharmacy Owner): sees all customer sales for the pharmacy.
 * - CSH (Cashier) & STF (Staff): sees ONLY customer sales created by themselves.
 */
const getCustomerSales = async (
  pharmacyId: string,
  user: ICustomerUserContext,
  customerId: string,
  query: Record<string, unknown>
) => {
  await validatePharmacyActive(pharmacyId);

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, pharmacyId },
  });

  if (!customer) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Customer not found",
      CUSTOMER_ERROR_CODES.CUSTOMER_NOT_FOUND
    );
  }

  const normalizedQuery: Record<string, unknown> = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
  };
  delete normalizedQuery.search;

  const saleQuery = new QueryBuilder(
    prisma.sale,
    normalizedQuery as any,
    {
      searchableFields: customerSalesSearchableFields,
      filterableFields: customerSalesFilterableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate();

  saleQuery.where({
    pharmacyId,
    customerId,
  });

  // Strict role-based enforcement at query level
  if (user.role === Role.CASHIER || user.role === Role.STAFF) {
    saleQuery.where({ createdById: user.id });
  }

  const result = await saleQuery.execute();

  const formattedData = result.data.map((sale: any) => ({
    id: sale.id,
    invoiceNo: sale.invoiceNo,
    soldAt: sale.soldAt,
    subtotal: round2(Number(sale.subtotal)),
    discountAmount: round2(Number(sale.discountAmount)),
    totalAmount: round2(Number(sale.totalAmount)),
    paidAmount: round2(Number(sale.paidAmount)),
    dueAmount: round2(Number(sale.dueAmount)),
    paymentMethod: sale.paymentMethod,
    status: sale.status,
    createdById: sale.createdById,
    createdAt: sale.createdAt,
  }));

  return {
    meta: result.meta,
    data: formattedData,
  };
};

/**
 * Get chronological customer due ledger.
 * - Sales that created dues: debit
 * - Due payments: credit
 * - Sales returns that reduced due: credit
 * Continuous running balance across pages that strictly reconciles with customer dueBalance.
 */
const getCustomerLedger = async (
  pharmacyId: string,
  customerId: string,
  query: Record<string, unknown>
) => {
  await validatePharmacyActive(pharmacyId);

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, pharmacyId },
  });

  if (!customer) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Customer not found",
      CUSTOMER_ERROR_CODES.CUSTOMER_NOT_FOUND
    );
  }

  // 1. Sales with due
  const sales = await prisma.sale.findMany({
    where: {
      pharmacyId,
      customerId,
      status: { not: SaleStatus.CANCELLED },
    },
    select: {
      id: true,
      invoiceNo: true,
      totalAmount: true,
      paidAmount: true,
      dueAmount: true,
      soldAt: true,
    },
    orderBy: { soldAt: "asc" },
  });

  // 2. Due payments
  const duePayments = await prisma.duePayment.findMany({
    where: {
      pharmacyId,
      customerId,
    },
    select: {
      id: true,
      amount: true,
      method: true,
      paidAt: true,
      note: true,
    },
    orderBy: { paidAt: "asc" },
  });

  // 3. Sales returns with due reduction
  const returns = await prisma.saleReturn.findMany({
    where: {
      pharmacyId,
      sale: { customerId },
      dueReduced: { gt: 0 },
    },
    select: {
      id: true,
      returnNo: true,
      dueReduced: true,
      createdAt: true,
      reason: true,
      sale: {
        select: {
          invoiceNo: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  interface IRawLedgerEntry {
    id: string;
    type: "SALE_DUE" | "DUE_PAYMENT" | "SALE_RETURN_DUE_REDUCTION";
    referenceNo: string;
    date: Date;
    description: string;
    debit: number;
    credit: number;
    runningBalance: number;
    timestamp: number;
    priority: number;
  }

  const rawEntries: IRawLedgerEntry[] = [];

  for (const s of sales) {
    const total = round2(Number(s.totalAmount));
    const paidAtSale = round2(Number(s.paidAmount));
    const initialDue = round2(Math.max(0, total - paidAtSale));

    if (initialDue > 0) {
      rawEntries.push({
        id: s.id,
        type: "SALE_DUE",
        referenceNo: s.invoiceNo,
        date: s.soldAt,
        description: `Invoice #${s.invoiceNo} (Total: ${total.toFixed(2)}, Paid: ${paidAtSale.toFixed(2)}, Due Created: ${initialDue.toFixed(2)})`,
        debit: initialDue,
        credit: 0,
        runningBalance: 0,
        timestamp: s.soldAt.getTime(),
        priority: 1, // Sales first
      });
    }
  }

  for (const ret of returns) {
    const dueReduced = round2(Number(ret.dueReduced));
    rawEntries.push({
      id: ret.id,
      type: "SALE_RETURN_DUE_REDUCTION",
      referenceNo: ret.returnNo,
      date: ret.createdAt,
      description: `Sales Return #${ret.returnNo} for Invoice #${ret.sale.invoiceNo} reduced due (${ret.reason || "Customer return"})`,
      debit: 0,
      credit: dueReduced,
      runningBalance: 0,
      timestamp: ret.createdAt.getTime(),
      priority: 2, // Returns second
    });
  }

  for (const dp of duePayments) {
    const amount = round2(Number(dp.amount));
    rawEntries.push({
      id: dp.id,
      type: "DUE_PAYMENT",
      referenceNo: dp.id,
      date: dp.paidAt,
      description: `Due payment collected via ${dp.method}${dp.note ? ` - ${dp.note}` : ""}`,
      debit: 0,
      credit: amount,
      runningBalance: 0,
      timestamp: dp.paidAt.getTime(),
      priority: 3, // Payments third
    });
  }

  // Deterministic chronological sorting:
  // 1. Timestamp ascending
  // 2. Priority ascending (Sales -> Returns -> Payments)
  // 3. ID ascending (deterministic tiebreaker)
  rawEntries.sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      a.priority - b.priority ||
      a.id.localeCompare(b.id)
  );

  let runningBalance = 0;
  let totalDueCreated = 0;
  let totalDuePaid = 0;
  let totalDueReducedByReturn = 0;

  for (const entry of rawEntries) {
    if (entry.type === "SALE_DUE") {
      totalDueCreated += entry.debit;
    } else if (entry.type === "DUE_PAYMENT") {
      totalDuePaid += entry.credit;
    } else if (entry.type === "SALE_RETURN_DUE_REDUCTION") {
      totalDueReducedByReturn += entry.credit;
    }

    runningBalance = round2(runningBalance + entry.debit - entry.credit);
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

  const formattedData: ICustomerLedgerEntry[] = paginatedEntries.map(
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
      totalDueCreated: round2(totalDueCreated),
      totalDuePaid: round2(totalDuePaid),
      totalDueReducedByReturn: round2(totalDueReducedByReturn),
      closingBalance,
      currentCustomerDueBalance: round2(Number(customer.dueBalance)),
    },
    data: formattedData,
  };
};

/**
 * Get list of customers who currently have an outstanding due balance (dueBalance > 0).
 * Powers the frontend customer due collection screen.
 */
const getDueCustomers = async (
  pharmacyId: string,
  query: Record<string, unknown>
) => {
  await validatePharmacyActive(pharmacyId);

  const normalizedQuery: Record<string, unknown> = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
  };
  delete normalizedQuery.search;

  const dueQuery = new QueryBuilder(
    prisma.customer,
    normalizedQuery as any,
    {
      searchableFields: customerSearchableFields,
      filterableFields: customerFilterableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate();

  dueQuery.where({
    pharmacyId,
    dueBalance: { gt: 0 },
    isActive: true,
  });

  const result = await dueQuery.execute();

  const formattedData = result.data.map((c: any) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    address: c.address,
    dueBalance: round2(Number(c.dueBalance)),
    creditLimit: c.creditLimit !== null ? round2(Number(c.creditLimit)) : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  return {
    meta: result.meta,
    data: formattedData,
  };
};

/**
 * Collect a customer due payment atomically with oldest-invoice-first allocation.
 * Uses row-level locks on Customer and Sale records to prevent concurrent over-collection.
 */
const createDuePayment = async (
  pharmacyId: string,
  user: ICustomerUserContext,
  customerId: string,
  payload: ICreateDuePaymentPayload,
  ip?: string,
  userAgent?: string
): Promise<IDuePaymentResult> => {
  await validatePharmacyActive(pharmacyId);

  const paymentAmount = round2(payload.amount);
  if (paymentAmount <= 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Payment amount must be greater than 0",
      CUSTOMER_ERROR_CODES.INVALID_PAYMENT_AMOUNT
    );
  }

  const paymentDate = payload.paidAt ? new Date(payload.paidAt) : new Date();

  return await prisma.$transaction(async (tx) => {
    // 1. Lock Customer row to serialize concurrent payment requests
    const lockedCustomers: any[] = await tx.$queryRaw`
      SELECT id, "pharmacyId", name, "dueBalance", "creditLimit", "isActive"
      FROM "Customer"
      WHERE id = ${customerId} AND "pharmacyId" = ${pharmacyId}
      FOR UPDATE
    `;

    if (!lockedCustomers || lockedCustomers.length === 0) {
      throw new AppError(
        httpStatus.NOT_FOUND,
        "Customer not found",
        CUSTOMER_ERROR_CODES.CUSTOMER_NOT_FOUND
      );
    }

    const lockedCustomer = lockedCustomers[0];

    if (!lockedCustomer.isActive) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Customer '${lockedCustomer.name}' is inactive and cannot accept payments.`,
        CUSTOMER_ERROR_CODES.CUSTOMER_INACTIVE
      );
    }

    const currentDueBalance = round2(Number(lockedCustomer.dueBalance));

    if (currentDueBalance <= 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Customer '${lockedCustomer.name}' has no outstanding due balance.`,
        CUSTOMER_ERROR_CODES.PAYMENT_EXCEEDS_DUE
      );
    }

    if (paymentAmount > currentDueBalance) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Payment amount (${paymentAmount.toFixed(2)} BDT) exceeds customer due balance (${currentDueBalance.toFixed(2)} BDT).`,
        CUSTOMER_ERROR_CODES.PAYMENT_EXCEEDS_DUE
      );
    }

    // 2. Lock and retrieve customer's unpaid invoices ordered oldest first
    const unpaidSales: any[] = await tx.$queryRaw`
      SELECT id, "invoiceNo", "dueAmount", "soldAt"
      FROM "Sale"
      WHERE "customerId" = ${customerId}
        AND "pharmacyId" = ${pharmacyId}
        AND "dueAmount" > 0
        AND "status" != 'CANCELLED'
      ORDER BY "soldAt" ASC, id ASC
      FOR UPDATE
    `;

    // 3. Create the DuePayment record
    const duePayment = await tx.duePayment.create({
      data: {
        pharmacyId,
        customerId,
        amount: paymentAmount,
        method: payload.method,
        paidAt: paymentDate,
        note: payload.note?.trim() || null,
        createdById: user.id,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });

    // 4. Allocate to oldest invoices first
    let remainingToAllocate = paymentAmount;
    const allocations: IDuePaymentAllocationResult[] = [];

    for (const sale of unpaidSales) {
      if (remainingToAllocate <= 0) break;
      const saleDue = round2(Number(sale.dueAmount));
      if (saleDue <= 0) continue;

      const allocate = round2(Math.min(remainingToAllocate, saleDue));
      remainingToAllocate = round2(remainingToAllocate - allocate);

      await tx.duePaymentAllocation.create({
        data: {
          duePaymentId: duePayment.id,
          saleId: sale.id,
          amount: allocate,
        },
      });

      const newSaleDue = round2(saleDue - allocate);
      await tx.sale.update({
        where: { id: sale.id },
        data: {
          dueAmount: newSaleDue,
        },
      });

      allocations.push({
        saleId: sale.id,
        invoiceNo: sale.invoiceNo,
        amount: allocate,
        remainingDue: newSaleDue,
      });
    }

    // 5. Update Customer due balance atomically
    const newCustomerDue = Math.max(0, round2(currentDueBalance - paymentAmount));
    await tx.customer.update({
      where: { id: customerId },
      data: {
        dueBalance: newCustomerDue,
      },
    });

    // 6. Record Audit Log
    await tx.auditLog.create({
      data: {
        pharmacyId,
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: "CUSTOMER_DUE_PAYMENT_COLLECTED",
        entityType: "DuePayment",
        entityId: duePayment.id,
        oldValue: { dueBalance: currentDueBalance },
        newValue: {
          duePaymentId: duePayment.id,
          amount: paymentAmount,
          method: payload.method,
          newDueBalance: newCustomerDue,
          allocationsCount: allocations.length,
        },
        reason: `Collected due payment of ${paymentAmount.toFixed(2)} BDT for customer '${lockedCustomer.name}'`,
        ip,
        userAgent,
      },
    });

    return {
      id: duePayment.id,
      pharmacyId: duePayment.pharmacyId,
      customerId: duePayment.customerId,
      customerName: lockedCustomer.name,
      amount: round2(Number(duePayment.amount)),
      method: duePayment.method,
      paidAt: duePayment.paidAt,
      note: duePayment.note,
      previousDueBalance: currentDueBalance,
      newDueBalance: newCustomerDue,
      allocations,
      createdBy: duePayment.createdBy,
      createdAt: duePayment.createdAt,
    };
  });
};

/**
 * Get due payment history for a customer.
 */
const getDuePayments = async (
  pharmacyId: string,
  customerId: string,
  query: Record<string, unknown>
) => {
  await validatePharmacyActive(pharmacyId);

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, pharmacyId },
  });

  if (!customer) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Customer not found",
      CUSTOMER_ERROR_CODES.CUSTOMER_NOT_FOUND
    );
  }

  const paymentQuery = new QueryBuilder(
    prisma.duePayment,
    query as any,
    {
      searchableFields: [],
      filterableFields: customerPaymentFilterableFields,
    }
  )
    .filter()
    .sort()
    .paginate();

  paymentQuery.where({
    pharmacyId,
    customerId,
  });

  paymentQuery.include({
    createdBy: {
      select: {
        id: true,
        name: true,
        role: true,
      },
    },
    allocations: {
      include: {
        sale: {
          select: {
            id: true,
            invoiceNo: true,
            soldAt: true,
          },
        },
      },
    },
  });

  const result = await paymentQuery.execute();

  const formattedData = result.data.map((dp: any) => ({
    id: dp.id,
    pharmacyId: dp.pharmacyId,
    customerId: dp.customerId,
    amount: round2(Number(dp.amount)),
    method: dp.method,
    paidAt: dp.paidAt,
    note: dp.note,
    createdBy: dp.createdBy,
    allocations: dp.allocations.map((a: any) => ({
      id: a.id,
      saleId: a.saleId,
      invoiceNo: a.sale?.invoiceNo,
      soldAt: a.sale?.soldAt,
      amount: round2(Number(a.amount)),
    })),
    createdAt: dp.createdAt,
  }));

  return {
    meta: result.meta,
    data: formattedData,
  };
};

export const CustomerService = {
  getCustomers,
  createCustomer,
  getCustomerById,
  updateCustomer,
  getCustomerSales,
  getCustomerLedger,
  getDueCustomers,
  createDuePayment,
  getDuePayments,
};
