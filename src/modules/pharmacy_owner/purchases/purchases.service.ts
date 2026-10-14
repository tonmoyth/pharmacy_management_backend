import httpStatus from "http-status";
import {
  PayMethod,
  PurchaseStatus,
  Role,
  StockMovementType,
  UnitName,
} from "@prisma/client";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { redisService } from "../../../utils/cache";
import { QueryBuilder } from "../../../utils/queryBuilder";
import {
  isBatchExpired,
  parseExpiryMMYYYY,
} from "../medicines_management/medicines_management.helper";
import {
  PRICE_WARNING_CODES,
  purchaseFilterableFields,
  purchaseSearchableFields,
} from "./purchases.constant";

export interface IPurchaseUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface IPurchaseItemInput {
  medicineId: string;
  unit: UnitName;
  quantity: number;
  batchNo: string;
  expiry: string; // MM/YYYY
  mrp?: number | null;
  purchasePrice: number;
  sellingPrice: number;
}

export interface ICreatePurchasePayload {
  supplierId: string;
  invoiceNo: string;
  purchaseDate: string;
  paidAmount?: number;
  paymentMethod?: PayMethod;
  note?: string | null;
  items: IPurchaseItemInput[];
}

export interface IUpdatePurchasePayload {
  invoiceNo?: string;
  purchaseDate?: string;
  note?: string | null;
  items?: IPurchaseItemInput[];
}

export interface IPriceWarning {
  code: string;
  message: string;
  medicineId: string;
  batchNo: string;
}

/**
 * Invalidate Redis medicine cache for this pharmacy.
 */
const invalidateMedicineCache = async (pharmacyId: string): Promise<void> => {
  try {
    await redisService.deleteByPattern(`medicines:${pharmacyId}:*`);
  } catch (err) {
    console.warn("Failed to invalidate medicine cache:", err);
  }
};

/**
 * Helper to generate non-blocking price warnings for purchase items.
 */
const checkPriceWarnings = (
  items: Array<{
    medicineName: string;
    medicineId: string;
    batchNo: string;
    purchasePricePerPiece: number;
    sellingPricePerPiece: number;
    mrpPerPiece: number | null;
  }>
): IPriceWarning[] => {
  const warnings: IPriceWarning[] = [];

  for (const item of items) {
    if (item.sellingPricePerPiece < item.purchasePricePerPiece) {
      warnings.push({
        code: PRICE_WARNING_CODES.SELLING_PRICE_BELOW_PURCHASE_PRICE,
        message: `Selling price (${item.sellingPricePerPiece.toFixed(2)}/pc) is below purchase price (${item.purchasePricePerPiece.toFixed(2)}/pc) for medicine '${item.medicineName}' (batch ${item.batchNo}).`,
        medicineId: item.medicineId,
        batchNo: item.batchNo,
      });
    }

    if (item.mrpPerPiece !== null && item.sellingPricePerPiece > item.mrpPerPiece) {
      warnings.push({
        code: PRICE_WARNING_CODES.SELLING_PRICE_ABOVE_MRP,
        message: `Selling price (${item.sellingPricePerPiece.toFixed(2)}/pc) exceeds MRP (${item.mrpPerPiece.toFixed(2)}/pc) for medicine '${item.medicineName}' (batch ${item.batchNo}).`,
        medicineId: item.medicineId,
        batchNo: item.batchNo,
      });
    }
  }

  return warnings;
};

/**
 * Check whether a purchase has any dependent transactions on its batches.
 * Returns { editable: boolean, reason: string | null }.
 */
const checkPurchaseEditable = async (
  pharmacyId: string,
  purchaseId: string
): Promise<{ editable: boolean; reason: string | null }> => {
  const purchase = await prisma.purchase.findFirst({
    where: {
      id: purchaseId,
      pharmacyId,
    },
    include: {
      items: {
        include: {
          batch: true,
        },
      },
    },
  });

  if (!purchase) {
    throw new AppError(httpStatus.NOT_FOUND, "Purchase not found");
  }

  if (purchase.status === PurchaseStatus.CANCELLED) {
    return {
      editable: false,
      reason: "Cancelled purchase cannot be edited or modified.",
    };
  }

  const batchIds = purchase.items.map((i) => i.batchId);
  const purchaseItemIds = purchase.items.map((i) => i.id);

  if (batchIds.length === 0) {
    return { editable: true, reason: null };
  }

  // 1. Check sales on these batches
  const saleItem = await prisma.saleItem.findFirst({
    where: { batchId: { in: batchIds } },
  });
  if (saleItem) {
    return {
      editable: false,
      reason:
        "Sales or returns exist for this purchase's batch, so it cannot be edited. Use Purchase Return for correction.",
    };
  }

  // 2. Check sale returns on these batches
  const saleReturnItem = await prisma.saleReturnItem.findFirst({
    where: { batchId: { in: batchIds } },
  });
  if (saleReturnItem) {
    return {
      editable: false,
      reason:
        "Sales or returns exist for this purchase's batch, so it cannot be edited. Use Purchase Return for correction.",
    };
  }

  // 3. Check purchase returns on this purchase or its batches
  const purchaseReturnItem = await prisma.purchaseReturnItem.findFirst({
    where: {
      OR: [
        { purchaseItemId: { in: purchaseItemIds } },
        { batchId: { in: batchIds } },
      ],
    },
  });
  if (purchaseReturnItem) {
    return {
      editable: false,
      reason:
        "Sales or returns exist for this purchase's batch, so it cannot be edited. Use Purchase Return for correction.",
    };
  }

  // 4. Check stock adjustments on these batches
  const stockAdjustment = await prisma.stockAdjustment.findFirst({
    where: { batchId: { in: batchIds } },
  });
  if (stockAdjustment) {
    return {
      editable: false,
      reason:
        "Sales or returns exist for this purchase's batch, so it cannot be edited. Use Purchase Return for correction.",
    };
  }

  // 5. Check other non-purchase stock movements on these batches
  const otherMovement = await prisma.stockMovement.findFirst({
    where: {
      batchId: { in: batchIds },
      type: {
        notIn: [StockMovementType.PURCHASE, StockMovementType.OPENING_STOCK],
      },
    },
  });
  if (otherMovement) {
    return {
      editable: false,
      reason:
        "Sales or returns exist for this purchase's batch, so it cannot be edited. Use Purchase Return for correction.",
    };
  }

  // 6. Check if current availableQty of any batch is lower than quantityPieces received in this purchase
  for (const item of purchase.items) {
    if (item.batch.availableQty < item.quantityPieces) {
      return {
        editable: false,
        reason:
          "Sales or returns exist for this purchase's batch, so it cannot be edited. Use Purchase Return for correction.",
      };
    }
  }

  return { editable: true, reason: null };
};

/**
 * List purchases belonging to the authenticated pharmacy.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const getPurchases = async (
  pharmacyId: string,
  query: Record<string, unknown>
) => {
  const normalizedQuery: Record<string, unknown> = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
    sortBy: query.sortBy || "purchaseDate",
    sortOrder: query.sortOrder || "desc",
  };

  const dateFrom = query.dateFrom as string | undefined;
  const dateTo = query.dateTo as string | undefined;
  const medicineId = query.medicineId as string | undefined;

  delete normalizedQuery.dateFrom;
  delete normalizedQuery.dateTo;
  delete normalizedQuery.medicineId;

  const purchaseQuery = new QueryBuilder(
    prisma.purchase,
    normalizedQuery as any,
    {
      searchableFields: purchaseSearchableFields,
      filterableFields: purchaseFilterableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate()
    .include({
      supplier: {
        select: {
          id: true,
          name: true,
          phone: true,
          company: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      _count: {
        select: {
          items: true,
          returns: true,
        },
      },
    });

  // Scope to authenticated pharmacy
  purchaseQuery.where({ pharmacyId });

  // Date range filtering
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) dateFilter.lte = new Date(dateTo);
    purchaseQuery.where({ purchaseDate: dateFilter });
  }

  // Medicine ID filtering
  if (medicineId) {
    purchaseQuery.where({
      items: {
        some: {
          medicineId,
        },
      },
    });
  }

  const result = await purchaseQuery.execute();

  const formattedData = result.data.map((p: any) => ({
    id: p.id,
    invoiceNo: p.invoiceNo,
    purchaseDate: p.purchaseDate,
    totalAmount: Number(p.totalAmount),
    paidAmount: Number(p.paidAmount),
    dueAmount: Number(p.dueAmount),
    status: p.status,
    note: p.note,
    supplier: p.supplier,
    createdBy: p.createdBy,
    itemCount: p._count?.items || 0,
    returnCount: p._count?.returns || 0,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  return {
    meta: result.meta,
    data: formattedData,
  };
};

/**
 * Return detailed purchase information by ID.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const getPurchaseById = async (pharmacyId: string, purchaseId: string) => {
  const purchase = await prisma.purchase.findFirst({
    where: {
      id: purchaseId,
      pharmacyId,
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
          phone: true,
          company: true,
          address: true,
          dueBalance: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      items: {
        include: {
          medicine: {
            select: {
              id: true,
              name: true,
              genericName: true,
              company: true,
              strength: true,
              dosageForm: true,
            },
          },
          batch: {
            select: {
              id: true,
              batchNo: true,
              expiryDate: true,
              mrp: true,
              purchasePrice: true,
              sellingPrice: true,
              receivedQty: true,
              availableQty: true,
            },
          },
        },
      },
      supplierPayments: {
        select: {
          id: true,
          amount: true,
          method: true,
          paidAt: true,
          note: true,
          createdById: true,
          createdAt: true,
        },
      },
      returns: {
        select: {
          id: true,
          returnNo: true,
          reason: true,
          totalAmount: true,
          createdAt: true,
        },
      },
    },
  });

  if (!purchase) {
    throw new AppError(httpStatus.NOT_FOUND, "Purchase not found");
  }

  const formattedItems = purchase.items.map((i: any) => ({
    id: i.id,
    medicineId: i.medicineId,
    medicineName: i.medicine?.name,
    genericName: i.medicine?.genericName,
    strength: i.medicine?.strength,
    dosageForm: i.medicine?.dosageForm,
    batchId: i.batchId,
    batchNo: i.batch?.batchNo,
    enteredUnit: i.enteredUnit,
    enteredQty: i.enteredQty,
    quantityPieces: i.quantityPieces,
    purchasePricePerPiece: Number(i.purchasePricePerPiece),
    sellingPricePerPiece: Number(i.sellingPricePerPiece),
    mrpPerPiece: i.mrpPerPiece !== null ? Number(i.mrpPerPiece) : null,
    expiryDate: i.expiryDate,
    lineTotal: Number(i.lineTotal),
    returnedQtyPieces: i.returnedQtyPieces,
    batch: i.batch
      ? {
          id: i.batch.id,
          batchNo: i.batch.batchNo,
          expiryDate: i.batch.expiryDate,
          mrp: i.batch.mrp !== null ? Number(i.batch.mrp) : null,
          purchasePrice: Number(i.batch.purchasePrice),
          sellingPrice: Number(i.batch.sellingPrice),
          receivedQty: i.batch.receivedQty,
          availableQty: i.batch.availableQty,
        }
      : null,
  }));

  const formattedPayments = purchase.supplierPayments.map((sp: any) => ({
    id: sp.id,
    amount: Number(sp.amount),
    method: sp.method,
    paidAt: sp.paidAt,
    note: sp.note,
    createdAt: sp.createdAt,
  }));

  const formattedReturns = purchase.returns.map((r: any) => ({
    id: r.id,
    returnNo: r.returnNo,
    reason: r.reason,
    totalAmount: Number(r.totalAmount),
    createdAt: r.createdAt,
  }));

  return {
    id: purchase.id,
    pharmacyId: purchase.pharmacyId,
    invoiceNo: purchase.invoiceNo,
    purchaseDate: purchase.purchaseDate,
    totalAmount: Number(purchase.totalAmount),
    paidAmount: Number(purchase.paidAmount),
    dueAmount: Number(purchase.dueAmount),
    status: purchase.status,
    note: purchase.note,
    cancelReason: purchase.cancelReason,
    cancelledAt: purchase.cancelledAt,
    supplier: {
      ...purchase.supplier,
      dueBalance: Number(purchase.supplier.dueBalance),
    },
    createdBy: purchase.createdBy,
    items: formattedItems,
    supplierPayments: formattedPayments,
    returns: formattedReturns,
    createdAt: purchase.createdAt,
    updatedAt: purchase.updatedAt,
  };
};

/**
 * Create a new purchase, update inventory, create stock movements,
 * update supplier due, and optionally record supplier payment in an atomic transaction.
 */
const createPurchase = async (
  pharmacyId: string,
  user: IPurchaseUserContext,
  payload: ICreatePurchasePayload,
  ip?: string,
  userAgent?: string
) => {
  // 1. Validate Supplier
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: payload.supplierId,
      pharmacyId,
    },
  });

  if (!supplier) {
    throw new AppError(httpStatus.NOT_FOUND, "Supplier not found");
  }

  if (!supplier.isActive) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Supplier '${supplier.name}' is inactive and cannot receive new purchases.`
    );
  }

  // 2. Validate Invoice No Uniqueness for this supplier & pharmacy
  const existingInvoice = await prisma.purchase.findUnique({
    where: {
      pharmacyId_supplierId_invoiceNo: {
        pharmacyId,
        supplierId: payload.supplierId,
        invoiceNo: payload.invoiceNo.trim(),
      },
    },
  });

  if (existingInvoice) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Invoice number '${payload.invoiceNo}' has already been recorded for this supplier.`
    );
  }

  // 3. Pre-fetch medicines and units
  const medicineIds = Array.from(new Set(payload.items.map((i) => i.medicineId)));
  const medicines = await prisma.medicine.findMany({
    where: {
      id: { in: medicineIds },
      pharmacyId,
    },
    include: {
      units: true,
    },
  });

  const medicineMap = new Map(medicines.map((m) => [m.id, m]));

  // Process & convert items
  interface IProcessedItem {
    medicineId: string;
    medicineName: string;
    unit: UnitName;
    enteredQty: number;
    quantityPieces: number;
    batchNo: string;
    expiryDate: Date;
    purchasePricePerPiece: number;
    sellingPricePerPiece: number;
    mrpPerPiece: number | null;
    lineTotal: number;
  }

  const processedItems: IProcessedItem[] = [];
  let calculatedTotalAmount = 0;

  for (const item of payload.items) {
    const med = medicineMap.get(item.medicineId);
    if (!med) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Medicine '${item.medicineId}' not found in your pharmacy.`
      );
    }

    if (med.status !== "ACTIVE") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Medicine '${med.name}' is inactive and cannot be purchased.`
      );
    }

    // Find configured unit conversion
    const unitConfig = med.units.find((u) => u.unit === item.unit);
    if (!unitConfig) {
      const available = med.units.map((u) => u.unit).join(", ") || "PIECE";
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Unit '${item.unit}' is not configured for medicine '${med.name}'. Configured units: ${available}.`
      );
    }

    // Validate Expiry Date (boundary check: end of expiry month)
    const expiryDate = parseExpiryMMYYYY(item.expiry);
    if (isBatchExpired(expiryDate)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Batch '${item.batchNo}' for medicine '${med.name}' has already expired (${item.expiry}).`
      );
    }

    const piecesPerUnit = unitConfig.piecesPerUnit;
    const quantityPieces = item.quantity * piecesPerUnit;

    // Convert prices per piece
    const purchasePricePerPiece =
      Math.round((item.purchasePrice / piecesPerUnit) * 100) / 100;
    const sellingPricePerPiece =
      Math.round((item.sellingPrice / piecesPerUnit) * 100) / 100;
    const mrpPerPiece =
      item.mrp !== undefined && item.mrp !== null
        ? Math.round((item.mrp / piecesPerUnit) * 100) / 100
        : null;

    // Line total = entered quantity * entered unit purchase price
    const lineTotal = Math.round(item.quantity * item.purchasePrice * 100) / 100;
    calculatedTotalAmount = Math.round((calculatedTotalAmount + lineTotal) * 100) / 100;

    processedItems.push({
      medicineId: med.id,
      medicineName: med.name,
      unit: item.unit,
      enteredQty: item.quantity,
      quantityPieces,
      batchNo: item.batchNo.trim(),
      expiryDate,
      purchasePricePerPiece,
      sellingPricePerPiece,
      mrpPerPiece,
      lineTotal,
    });
  }

  // 4. Validate paidAmount
  const paidAmount = Math.round((payload.paidAmount || 0) * 100) / 100;
  if (paidAmount < 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Paid amount cannot be negative"
    );
  }

  if (paidAmount > calculatedTotalAmount) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Paid amount (${paidAmount} BDT) cannot exceed purchase total (${calculatedTotalAmount} BDT).`
    );
  }

  const dueAmount = Math.round((calculatedTotalAmount - paidAmount) * 100) / 100;

  // 5. Collect non-blocking price warnings
  const warnings = checkPriceWarnings(processedItems);

  // 6. Execute atomic database transaction
  const purchaseResult = await prisma.$transaction(
    async (tx) => {
      // Create Purchase record
      const purchase = await tx.purchase.create({
        data: {
          pharmacyId,
          supplierId: payload.supplierId,
          invoiceNo: payload.invoiceNo.trim(),
          purchaseDate: new Date(payload.purchaseDate),
          totalAmount: calculatedTotalAmount,
          paidAmount,
          dueAmount,
          status: PurchaseStatus.COMPLETED,
          note: payload.note?.trim() || null,
          createdById: user.id,
        },
      });

      // Process each item: create/update batch, create purchase item, create stock movement
      const createdItems = [];

      for (const item of processedItems) {
        // Find existing matching batch by business key:
        // [medicineId, batchNo, purchasePrice, sellingPrice]
        let batch = await tx.medicineBatch.findFirst({
          where: {
            pharmacyId,
            medicineId: item.medicineId,
            batchNo: item.batchNo,
            purchasePrice: item.purchasePricePerPiece,
            sellingPrice: item.sellingPricePerPiece,
          },
        });

        if (batch) {
          batch = await tx.medicineBatch.update({
            where: { id: batch.id },
            data: {
              receivedQty: { increment: item.quantityPieces },
              availableQty: { increment: item.quantityPieces },
              ...(item.mrpPerPiece !== null ? { mrp: item.mrpPerPiece } : {}),
            },
          });
        } else {
          batch = await tx.medicineBatch.create({
            data: {
              pharmacyId,
              medicineId: item.medicineId,
              batchNo: item.batchNo,
              expiryDate: item.expiryDate,
              mrp: item.mrpPerPiece,
              purchasePrice: item.purchasePricePerPiece,
              sellingPrice: item.sellingPricePerPiece,
              receivedQty: item.quantityPieces,
              availableQty: item.quantityPieces,
            },
          });
        }

        // Create PurchaseItem
        const pItem = await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            medicineId: item.medicineId,
            batchId: batch.id,
            enteredUnit: item.unit,
            enteredQty: item.enteredQty,
            quantityPieces: item.quantityPieces,
            purchasePricePerPiece: item.purchasePricePerPiece,
            sellingPricePerPiece: item.sellingPricePerPiece,
            mrpPerPiece: item.mrpPerPiece,
            expiryDate: item.expiryDate,
            lineTotal: item.lineTotal,
          },
        });

        // Create StockMovement (type: PURCHASE, positive pieces)
        await tx.stockMovement.create({
          data: {
            pharmacyId,
            medicineId: item.medicineId,
            batchId: batch.id,
            type: StockMovementType.PURCHASE,
            quantityPieces: item.quantityPieces,
            balanceAfter: batch.availableQty,
            refType: "Purchase",
            refId: purchase.id,
            note: `Purchase invoice #${purchase.invoiceNo} (${item.enteredQty} ${item.unit})`,
            createdById: user.id,
          },
        });

        createdItems.push({
          ...pItem,
          purchasePricePerPiece: Number(pItem.purchasePricePerPiece),
          sellingPricePerPiece: Number(pItem.sellingPricePerPiece),
          mrpPerPiece: pItem.mrpPerPiece !== null ? Number(pItem.mrpPerPiece) : null,
          lineTotal: Number(pItem.lineTotal),
          batchNo: batch.batchNo,
        });
      }

      // Increase supplier outstanding due balance by dueAmount
      await tx.supplier.update({
        where: { id: payload.supplierId },
        data: {
          dueBalance: { increment: dueAmount },
        },
      });

      // If paidAmount > 0, record corresponding SupplierPayment
      let createdPayment = null;
      if (paidAmount > 0) {
        createdPayment = await tx.supplierPayment.create({
          data: {
            pharmacyId,
            supplierId: payload.supplierId,
            purchaseId: purchase.id,
            amount: paidAmount,
            method: payload.paymentMethod || PayMethod.CASH,
            paidAt: new Date(payload.purchaseDate),
            note: `Immediate payment for purchase invoice #${purchase.invoiceNo}`,
            createdById: user.id,
          },
        });
      }

      // Record AuditLog
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "PURCHASE_CREATED",
          entityType: "Purchase",
          entityId: purchase.id,
          newValue: {
            id: purchase.id,
            invoiceNo: purchase.invoiceNo,
            supplierId: purchase.supplierId,
            totalAmount: calculatedTotalAmount,
            paidAmount,
            dueAmount,
            itemCount: processedItems.length,
          },
          reason: `Created purchase #${purchase.invoiceNo} from supplier '${supplier.name}'`,
          ip,
          userAgent,
        },
      });

      return {
        purchase: {
          ...purchase,
          totalAmount: Number(purchase.totalAmount),
          paidAmount: Number(purchase.paidAmount),
          dueAmount: Number(purchase.dueAmount),
          items: createdItems,
          payment: createdPayment
            ? {
                ...createdPayment,
                amount: Number(createdPayment.amount),
              }
            : null,
        },
      };
    },
    {
      maxWait: 15000,
      timeout: 30000,
    }
  );

  // Invalidate Redis medicine cache
  await invalidateMedicineCache(pharmacyId);

  return {
    ...purchaseResult,
    warnings,
  };
};

/**
 * Edit an existing purchase.
 * Strict guard: blocks edit with 409 if dependent transactions exist on any batch.
 */
const updatePurchase = async (
  pharmacyId: string,
  purchaseId: string,
  user: IPurchaseUserContext,
  payload: IUpdatePurchasePayload,
  ip?: string,
  userAgent?: string
) => {
  // Pre-fetch purchase ensuring tenant ownership
  const existingPurchase = await prisma.purchase.findFirst({
    where: {
      id: purchaseId,
      pharmacyId,
    },
    include: {
      items: {
        include: {
          batch: true,
        },
      },
      supplier: true,
    },
  });

  if (!existingPurchase) {
    throw new AppError(httpStatus.NOT_FOUND, "Purchase not found");
  }

  if (existingPurchase.status === PurchaseStatus.CANCELLED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot edit a cancelled purchase."
    );
  }

  // Pre-check edit guard
  const editCheck = await checkPurchaseEditable(pharmacyId, purchaseId);
  if (!editCheck.editable) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Sales or returns exist for this purchase's batch, so it cannot be edited. Use Purchase Return for correction.",
      "PURCHASE_HAS_DEPENDENTS"
    );
  }

  // Check invoice uniqueness if changing invoiceNo
  if (
    payload.invoiceNo &&
    payload.invoiceNo.trim() !== existingPurchase.invoiceNo
  ) {
    const duplicateInvoice = await prisma.purchase.findUnique({
      where: {
        pharmacyId_supplierId_invoiceNo: {
          pharmacyId,
          supplierId: existingPurchase.supplierId,
          invoiceNo: payload.invoiceNo.trim(),
        },
      },
    });

    if (duplicateInvoice) {
      throw new AppError(
        httpStatus.CONFLICT,
        `Invoice number '${payload.invoiceNo}' has already been recorded for this supplier.`
      );
    }
  }

  // If items are being updated, pre-process new items
  let newCalculatedTotal = Number(existingPurchase.totalAmount);
  let warnings: IPriceWarning[] = [];
  let processedNewItems: Array<{
    medicineId: string;
    medicineName: string;
    unit: UnitName;
    enteredQty: number;
    quantityPieces: number;
    batchNo: string;
    expiryDate: Date;
    purchasePricePerPiece: number;
    sellingPricePerPiece: number;
    mrpPerPiece: number | null;
    lineTotal: number;
  }> = [];

  if (payload.items && payload.items.length > 0) {
    const medicineIds = Array.from(new Set(payload.items.map((i) => i.medicineId)));
    const medicines = await prisma.medicine.findMany({
      where: {
        id: { in: medicineIds },
        pharmacyId,
      },
      include: {
        units: true,
      },
    });

    const medicineMap = new Map(medicines.map((m) => [m.id, m]));
    newCalculatedTotal = 0;

    for (const item of payload.items) {
      const med = medicineMap.get(item.medicineId);
      if (!med) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Medicine '${item.medicineId}' not found in your pharmacy.`
        );
      }

      if (med.status !== "ACTIVE") {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Medicine '${med.name}' is inactive and cannot be purchased.`
        );
      }

      const unitConfig = med.units.find((u) => u.unit === item.unit);
      if (!unitConfig) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Unit '${item.unit}' is not configured for medicine '${med.name}'.`
        );
      }

      const expiryDate = parseExpiryMMYYYY(item.expiry);
      if (isBatchExpired(expiryDate)) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Batch '${item.batchNo}' for medicine '${med.name}' has already expired (${item.expiry}).`
        );
      }

      const piecesPerUnit = unitConfig.piecesPerUnit;
      const quantityPieces = item.quantity * piecesPerUnit;
      const purchasePricePerPiece =
        Math.round((item.purchasePrice / piecesPerUnit) * 100) / 100;
      const sellingPricePerPiece =
        Math.round((item.sellingPrice / piecesPerUnit) * 100) / 100;
      const mrpPerPiece =
        item.mrp !== undefined && item.mrp !== null
          ? Math.round((item.mrp / piecesPerUnit) * 100) / 100
          : null;
      const lineTotal =
        Math.round(item.quantity * item.purchasePrice * 100) / 100;
      newCalculatedTotal =
        Math.round((newCalculatedTotal + lineTotal) * 100) / 100;

      processedNewItems.push({
        medicineId: med.id,
        medicineName: med.name,
        unit: item.unit,
        enteredQty: item.quantity,
        quantityPieces,
        batchNo: item.batchNo.trim(),
        expiryDate,
        purchasePricePerPiece,
        sellingPricePerPiece,
        mrpPerPiece,
        lineTotal,
      });
    }

    // Safety check: Cannot reduce total below already paid amount
    const paidAmount = Number(existingPurchase.paidAmount);
    if (newCalculatedTotal < paidAmount) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Cannot reduce purchase total (${newCalculatedTotal} BDT) below already paid amount (${paidAmount} BDT). Use Purchase Return for refunds.`
      );
    }

    warnings = checkPriceWarnings(processedNewItems);
  }

  // Atomic update transaction
  const updatedResult = await prisma.$transaction(
    async (tx) => {
      // Re-verify dependent transaction guard inside transaction
      const batchIds = existingPurchase.items.map((i) => i.batchId);
      if (batchIds.length > 0) {
        const saleCheck = await tx.saleItem.findFirst({
          where: { batchId: { in: batchIds } },
        });
        if (saleCheck) {
          throw new AppError(
            httpStatus.CONFLICT,
            "Sales or returns exist for this purchase's batch, so it cannot be edited. Use Purchase Return for correction.",
            "PURCHASE_HAS_DEPENDENTS"
          );
        }
      }

      // If items are modified, reverse old items from inventory
      if (processedNewItems.length > 0) {
        for (const oldItem of existingPurchase.items) {
          // Decrement availableQty and receivedQty
          await tx.medicineBatch.update({
            where: { id: oldItem.batchId },
            data: {
              availableQty: { decrement: oldItem.quantityPieces },
              receivedQty: { decrement: oldItem.quantityPieces },
            },
          });
        }

        // Delete old purchase items
        await tx.purchaseItem.deleteMany({
          where: { purchaseId },
        });

        // Apply new items and batches
        for (const item of processedNewItems) {
          let batch = await tx.medicineBatch.findFirst({
            where: {
              pharmacyId,
              medicineId: item.medicineId,
              batchNo: item.batchNo,
              purchasePrice: item.purchasePricePerPiece,
              sellingPrice: item.sellingPricePerPiece,
            },
          });

          if (batch) {
            batch = await tx.medicineBatch.update({
              where: { id: batch.id },
              data: {
                receivedQty: { increment: item.quantityPieces },
                availableQty: { increment: item.quantityPieces },
                ...(item.mrpPerPiece !== null ? { mrp: item.mrpPerPiece } : {}),
              },
            });
          } else {
            batch = await tx.medicineBatch.create({
              data: {
                pharmacyId,
                medicineId: item.medicineId,
                batchNo: item.batchNo,
                expiryDate: item.expiryDate,
                mrp: item.mrpPerPiece,
                purchasePrice: item.purchasePricePerPiece,
                sellingPrice: item.sellingPricePerPiece,
                receivedQty: item.quantityPieces,
                availableQty: item.quantityPieces,
              },
            });
          }

          // Create new PurchaseItem
          await tx.purchaseItem.create({
            data: {
              purchaseId,
              medicineId: item.medicineId,
              batchId: batch.id,
              enteredUnit: item.unit,
              enteredQty: item.enteredQty,
              quantityPieces: item.quantityPieces,
              purchasePricePerPiece: item.purchasePricePerPiece,
              sellingPricePerPiece: item.sellingPricePerPiece,
              mrpPerPiece: item.mrpPerPiece,
              expiryDate: item.expiryDate,
              lineTotal: item.lineTotal,
            },
          });

          // StockMovement for edited purchase replacement
          await tx.stockMovement.create({
            data: {
              pharmacyId,
              medicineId: item.medicineId,
              batchId: batch.id,
              type: StockMovementType.PURCHASE,
              quantityPieces: item.quantityPieces,
              balanceAfter: batch.availableQty,
              refType: "Purchase",
              refId: purchaseId,
              note: `Purchase edit #${payload.invoiceNo || existingPurchase.invoiceNo} (${item.enteredQty} ${item.unit})`,
              createdById: user.id,
            },
          });
        }
      }

      // Calculate difference in totalAmount and update supplier due
      const oldTotal = Number(existingPurchase.totalAmount);
      const paidAmount = Number(existingPurchase.paidAmount);
      const newDue = Math.round((newCalculatedTotal - paidAmount) * 100) / 100;
      const totalDifference = Math.round((newCalculatedTotal - oldTotal) * 100) / 100;

      if (totalDifference !== 0) {
        await tx.supplier.update({
          where: { id: existingPurchase.supplierId },
          data: {
            dueBalance: { increment: totalDifference },
          },
        });
      }

      // Update purchase header
      const updatedPurchase = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          invoiceNo: payload.invoiceNo?.trim() || existingPurchase.invoiceNo,
          purchaseDate: payload.purchaseDate
            ? new Date(payload.purchaseDate)
            : existingPurchase.purchaseDate,
          totalAmount: newCalculatedTotal,
          dueAmount: newDue,
          note: payload.note !== undefined ? payload.note?.trim() || null : existingPurchase.note,
        },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "PURCHASE_UPDATED",
          entityType: "Purchase",
          entityId: purchaseId,
          oldValue: {
            invoiceNo: existingPurchase.invoiceNo,
            totalAmount: oldTotal,
            dueAmount: Number(existingPurchase.dueAmount),
          },
          newValue: {
            invoiceNo: updatedPurchase.invoiceNo,
            totalAmount: newCalculatedTotal,
            dueAmount: newDue,
          },
          reason: `Updated purchase #${updatedPurchase.invoiceNo}`,
          ip,
          userAgent,
        },
      });

      return updatedPurchase;
    },
    {
      maxWait: 15000,
      timeout: 30000,
    }
  );

  // Invalidate Redis medicine cache
  await invalidateMedicineCache(pharmacyId);

  return {
    purchase: {
      ...updatedResult,
      totalAmount: Number(updatedResult.totalAmount),
      paidAmount: Number(updatedResult.paidAmount),
      dueAmount: Number(updatedResult.dueAmount),
    },
    warnings,
  };
};

/**
 * Cancel a purchase.
 * Strict guard: blocks cancel with 409 if dependent transactions exist on any batch.
 * Reverses stock movements with type PURCHASE_CANCEL (negative pieces),
 * adjusts supplier due, sets status CANCELLED, and preserves historical payments.
 */
const cancelPurchase = async (
  pharmacyId: string,
  purchaseId: string,
  user: IPurchaseUserContext,
  payload: { reason: string },
  ip?: string,
  userAgent?: string
) => {
  const existingPurchase = await prisma.purchase.findFirst({
    where: {
      id: purchaseId,
      pharmacyId,
    },
    include: {
      items: {
        include: {
          batch: true,
        },
      },
      supplier: true,
    },
  });

  if (!existingPurchase) {
    throw new AppError(httpStatus.NOT_FOUND, "Purchase not found");
  }

  if (existingPurchase.status === PurchaseStatus.CANCELLED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This purchase has already been cancelled."
    );
  }

  // Pre-check edit/cancel guard
  const editCheck = await checkPurchaseEditable(pharmacyId, purchaseId);
  if (!editCheck.editable) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Sales or returns exist for this purchase's batch, so it cannot be cancelled. Use Purchase Return for correction.",
      "PURCHASE_HAS_DEPENDENTS"
    );
  }

  // Execute atomic cancellation transaction
  const cancelledResult = await prisma.$transaction(
    async (tx) => {
      // Re-verify guard inside transaction
      const batchIds = existingPurchase.items.map((i) => i.batchId);
      if (batchIds.length > 0) {
        const saleCheck = await tx.saleItem.findFirst({
          where: { batchId: { in: batchIds } },
        });
        if (saleCheck) {
          throw new AppError(
            httpStatus.CONFLICT,
            "Sales or returns exist for this purchase's batch, so it cannot be cancelled. Use Purchase Return for correction.",
            "PURCHASE_HAS_DEPENDENTS"
          );
        }
      }

      // Reverse stock effects for each item
      for (const item of existingPurchase.items) {
        // Ensure available stock doesn't become negative
        const batch = await tx.medicineBatch.findUnique({
          where: { id: item.batchId },
        });

        if (!batch || batch.availableQty < item.quantityPieces) {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            `Cannot cancel purchase: insufficient stock available in batch '${item.batch.batchNo}' to reverse purchase.`
          );
        }

        const updatedBatch = await tx.medicineBatch.update({
          where: { id: item.batchId },
          data: {
            availableQty: { decrement: item.quantityPieces },
            receivedQty: { decrement: item.quantityPieces },
          },
        });

        // Record StockMovement with type PURCHASE_CANCEL and negative pieces
        await tx.stockMovement.create({
          data: {
            pharmacyId,
            medicineId: item.medicineId,
            batchId: item.batchId,
            type: StockMovementType.PURCHASE_CANCEL,
            quantityPieces: -item.quantityPieces,
            balanceAfter: updatedBatch.availableQty,
            refType: "Purchase",
            refId: purchaseId,
            note: `Purchase cancellation #${existingPurchase.invoiceNo}: ${payload.reason.trim()}`,
            createdById: user.id,
          },
        });
      }

      // Adjust supplier due balance:
      // When purchase is cancelled, the supplier liability attributable to this purchase's remaining dueAmount is removed.
      const dueAmountToDeduct = Number(existingPurchase.dueAmount);
      if (dueAmountToDeduct > 0) {
        await tx.supplier.update({
          where: { id: existingPurchase.supplierId },
          data: {
            dueBalance: { decrement: dueAmountToDeduct },
          },
        });
      }

      // Update purchase record to CANCELLED and dueAmount to 0
      const cancelledPurchase = await tx.purchase.update({
        where: { id: purchaseId },
        data: {
          status: PurchaseStatus.CANCELLED,
          dueAmount: 0,
          cancelReason: payload.reason.trim(),
          cancelledAt: new Date(),
        },
      });

      // AuditLog
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "PURCHASE_CANCELLED",
          entityType: "Purchase",
          entityId: purchaseId,
          oldValue: {
            status: existingPurchase.status,
            totalAmount: Number(existingPurchase.totalAmount),
            dueAmount: Number(existingPurchase.dueAmount),
          },
          newValue: {
            status: PurchaseStatus.CANCELLED,
            dueAmount: 0,
            cancelReason: payload.reason.trim(),
          },
          reason: payload.reason.trim(),
          ip,
          userAgent,
        },
      });

      return cancelledPurchase;
    },
    {
      maxWait: 15000,
      timeout: 30000,
    }
  );

  // Invalidate Redis medicine cache
  await invalidateMedicineCache(pharmacyId);

  return {
    purchase: {
      ...cancelledResult,
      totalAmount: Number(cancelledResult.totalAmount),
      paidAmount: Number(cancelledResult.paidAmount),
      dueAmount: Number(cancelledResult.dueAmount),
    },
    message: "Purchase cancelled successfully",
  };
};

export const PurchaseService = {
  getPurchases,
  getPurchaseById,
  createPurchase,
  checkPurchaseEditable,
  updatePurchase,
  cancelPurchase,
};
