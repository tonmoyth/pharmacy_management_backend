import httpStatus from "http-status";
import {
  DocType,
  PurchaseReturnReason,
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
  PURCHASE_RETURN_ERROR_CODES,
  purchaseReturnFilterableFields,
  purchaseReturnSearchableFields,
} from "./purchase_returns.constant";

export interface IPurchaseReturnUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface ICreatePurchaseReturnItemInput {
  purchaseItemId: string;
  quantity: number;
  unit: UnitName;
}

export interface ICreatePurchaseReturnPayload {
  purchaseId: string;
  reason: PurchaseReturnReason;
  note?: string | null;
  items: ICreatePurchaseReturnItemInput[];
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
 * List purchase returns belonging to the authenticated pharmacy.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const getPurchaseReturns = async (
  pharmacyId: string,
  query: Record<string, unknown>
) => {
  const normalizedQuery: Record<string, unknown> = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
    sortBy: query.sortBy || "createdAt",
    sortOrder: query.sortOrder || "desc",
  };

  const dateFrom = query.dateFrom as string | undefined;
  const dateTo = query.dateTo as string | undefined;

  delete normalizedQuery.dateFrom;
  delete normalizedQuery.dateTo;

  const returnQuery = new QueryBuilder(
    prisma.purchaseReturn,
    normalizedQuery as any,
    {
      searchableFields: purchaseReturnSearchableFields,
      filterableFields: purchaseReturnFilterableFields,
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
      purchase: {
        select: {
          id: true,
          invoiceNo: true,
          purchaseDate: true,
          totalAmount: true,
          status: true,
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
      _count: {
        select: {
          items: true,
        },
      },
    });

  // Scope strictly to authenticated pharmacy
  returnQuery.where({ pharmacyId });

  // Date range filtering on createdAt
  if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) dateFilter.gte = new Date(dateFrom);
    if (dateTo) {
      // Set to end of the day if date string does not include time
      const toDate = new Date(dateTo);
      if (dateTo.length <= 10) {
        toDate.setHours(23, 59, 59, 999);
      }
      dateFilter.lte = toDate;
    }
    returnQuery.where({ createdAt: dateFilter });
  }

  const result = await returnQuery.execute();

  const formattedData = result.data.map((r: any) => ({
    id: r.id,
    returnNo: r.returnNo,
    returnDate: r.createdAt,
    createdAt: r.createdAt,
    reason: r.reason,
    note: r.note,
    totalAmount: Number(r.totalAmount),
    supplier: r.supplier,
    purchase: {
      id: r.purchase?.id,
      invoiceNo: r.purchase?.invoiceNo,
      purchaseDate: r.purchase?.purchaseDate,
      totalAmount: Number(r.purchase?.totalAmount || 0),
      status: r.purchase?.status,
    },
    createdBy: r.createdBy,
    itemCount: r._count?.items ?? 0,
  }));

  return {
    meta: result.meta,
    data: formattedData,
  };
};

/**
 * Return detailed purchase return information by ID.
 * Accessible by PHARMACY_OWNER and STAFF.
 */
const getPurchaseReturnById = async (
  pharmacyId: string,
  returnId: string
) => {
  const purchaseReturn = await prisma.purchaseReturn.findFirst({
    where: {
      id: returnId,
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
      purchase: {
        select: {
          id: true,
          invoiceNo: true,
          purchaseDate: true,
          totalAmount: true,
          paidAmount: true,
          dueAmount: true,
          status: true,
          note: true,
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
          purchaseItem: {
            include: {
              medicine: {
                select: {
                  id: true,
                  name: true,
                  genericName: true,
                  company: true,
                  strength: true,
                  dosageForm: true,
                  units: true,
                },
              },
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
    },
  });

  if (!purchaseReturn) {
    throw new AppError(httpStatus.NOT_FOUND, "Purchase return not found");
  }

  const formattedItems = purchaseReturn.items.map((item: any) => {
    const pItem = item.purchaseItem;
    const med = pItem?.medicine;
    const batch = item.batch;

    // Determine entered unit and piecesPerUnit to show quantity in entered unit
    const enteredUnit = pItem?.enteredUnit || UnitName.PIECE;
    const unitConfig = med?.units?.find((u: any) => u.unit === enteredUnit);
    const piecesPerUnit = unitConfig?.piecesPerUnit || 1;
    const quantityInEnteredUnit =
      Math.round((item.quantityPieces / piecesPerUnit) * 100) / 100;

    return {
      id: item.id,
      purchaseReturnId: item.purchaseReturnId,
      purchaseItemId: item.purchaseItemId,
      batchId: item.batchId,
      quantityPieces: item.quantityPieces,
      enteredUnit,
      quantityInEnteredUnit,
      unitPricePerPiece: Number(item.unitPricePerPiece),
      lineTotal: Number(item.lineTotal),
      purchaseItem: pItem
        ? {
            id: pItem.id,
            enteredUnit: pItem.enteredUnit,
            enteredQty: pItem.enteredQty,
            quantityPieces: pItem.quantityPieces,
            purchasePricePerPiece: Number(pItem.purchasePricePerPiece),
            sellingPricePerPiece: Number(pItem.sellingPricePerPiece),
            mrpPerPiece:
              pItem.mrpPerPiece !== null ? Number(pItem.mrpPerPiece) : null,
            expiryDate: pItem.expiryDate,
            lineTotal: Number(pItem.lineTotal),
            returnedQtyPieces: pItem.returnedQtyPieces,
          }
        : null,
      medicine: med
        ? {
            id: med.id,
            name: med.name,
            genericName: med.genericName,
            company: med.company,
            strength: med.strength,
            dosageForm: med.dosageForm,
          }
        : null,
      batch: batch
        ? {
            id: batch.id,
            batchNo: batch.batchNo,
            expiryDate: batch.expiryDate,
            mrp: batch.mrp !== null ? Number(batch.mrp) : null,
            purchasePrice: Number(batch.purchasePrice),
            sellingPrice: Number(batch.sellingPrice),
            receivedQty: batch.receivedQty,
            availableQty: batch.availableQty,
          }
        : null,
    };
  });

  return {
    id: purchaseReturn.id,
    pharmacyId: purchaseReturn.pharmacyId,
    returnNo: purchaseReturn.returnNo,
    returnDate: purchaseReturn.createdAt,
    reason: purchaseReturn.reason,
    note: purchaseReturn.note,
    totalAmount: Number(purchaseReturn.totalAmount),
    supplier: {
      ...purchaseReturn.supplier,
      dueBalance: Number(purchaseReturn.supplier?.dueBalance || 0),
    },
    purchase: {
      ...purchaseReturn.purchase,
      totalAmount: Number(purchaseReturn.purchase?.totalAmount || 0),
      paidAmount: Number(purchaseReturn.purchase?.paidAmount || 0),
      dueAmount: Number(purchaseReturn.purchase?.dueAmount || 0),
    },
    createdBy: purchaseReturn.createdBy,
    items: formattedItems,
    createdAt: purchaseReturn.createdAt,
  };
};

/**
 * Create a purchase return, decrement batch inventory, create stock movements,
 * update purchase item returned quantities, and decrement supplier due atomically.
 */
const createPurchaseReturn = async (
  pharmacyId: string,
  user: IPurchaseReturnUserContext,
  payload: ICreatePurchaseReturnPayload,
  ip?: string,
  userAgent?: string
) => {
  // 1. Validate Purchase exists and belongs to the authenticated pharmacy
  const purchase = await prisma.purchase.findFirst({
    where: {
      id: payload.purchaseId,
      pharmacyId,
    },
    include: {
      supplier: true,
      items: {
        include: {
          batch: true,
          medicine: {
            include: {
              units: true,
            },
          },
        },
      },
    },
  });

  if (!purchase) {
    throw new AppError(httpStatus.NOT_FOUND, "Purchase not found");
  }

  // Follow cancellation rules: do not allow returning from a cancelled purchase
  if (purchase.status === PurchaseStatus.CANCELLED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cannot return items from a cancelled purchase."
    );
  }

  // 2. Validate Supplier belongs to the same pharmacy
  if (purchase.supplier.pharmacyId !== pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Supplier associated with this purchase does not belong to your pharmacy."
    );
  }

  // 3. Reject duplicate item entries in the same request
  const seenItemIds = new Set<string>();
  for (const item of payload.items) {
    if (seenItemIds.has(item.purchaseItemId)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Duplicate purchase item entry detected for item ID '${item.purchaseItemId}'. Please combine quantities into a single item entry.`
      );
    }
    seenItemIds.add(item.purchaseItemId);
  }

  // Map purchase items by ID
  const purchaseItemMap = new Map(purchase.items.map((pi) => [pi.id, pi]));

  interface IProcessedReturnItem {
    purchaseItemId: string;
    medicineId: string;
    medicineName: string;
    batchId: string;
    batchNo: string;
    enteredUnit: UnitName;
    enteredQty: number;
    quantityPieces: number;
    unitPricePerPiece: number;
    lineTotal: number;
  }

  const processedReturnItems: IProcessedReturnItem[] = [];
  let calculatedTotalReturnAmount = 0;

  // 4. Validate each return item
  for (const item of payload.items) {
    const purchaseItem = purchaseItemMap.get(item.purchaseItemId);
    if (!purchaseItem) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Purchase item '${item.purchaseItemId}' does not belong to purchase '${purchase.id}'.`
      );
    }

    const medicine = purchaseItem.medicine;
    const batch = purchaseItem.batch;

    // Unit conversion
    const unitConfig = medicine.units.find((u) => u.unit === item.unit);
    if (!unitConfig) {
      const availableUnits =
        medicine.units.map((u) => u.unit).join(", ") || "PIECE";
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Unit '${item.unit}' is not configured for medicine '${medicine.name}'. Configured units: ${availableUnits}.`
      );
    }

    const piecesPerUnit = unitConfig.piecesPerUnit;
    const requestedPieces = item.quantity * piecesPerUnit;

    // Condition 1: Total returned quantity for this purchase item must not exceed purchased quantity
    const alreadyReturned = purchaseItem.returnedQtyPieces;
    const remainingPurchasedPieces =
      purchaseItem.quantityPieces - alreadyReturned;

    if (requestedPieces > remainingPurchasedPieces) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Return quantity (${requestedPieces} pcs) exceeds remaining returnable quantity (${remainingPurchasedPieces} pcs) for purchase item '${purchaseItem.id}'.`,
        PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED
      );
    }

    // Condition 2: Requested pieces must not exceed batch's current availableQty
    if (requestedPieces > batch.availableQty) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Return quantity (${requestedPieces} pcs) exceeds available stock (${batch.availableQty} pcs) in batch '${batch.batchNo}' for medicine '${medicine.name}'.`,
        PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED
      );
    }

    // Return valuation: original purchase price attributable to the returned quantity
    const purchasePricePerPiece = Number(purchaseItem.purchasePricePerPiece);
    const lineTotal =
      Math.round(requestedPieces * purchasePricePerPiece * 100) / 100;
    calculatedTotalReturnAmount =
      Math.round((calculatedTotalReturnAmount + lineTotal) * 100) / 100;

    processedReturnItems.push({
      purchaseItemId: purchaseItem.id,
      medicineId: medicine.id,
      medicineName: medicine.name,
      batchId: batch.id,
      batchNo: batch.batchNo,
      enteredUnit: item.unit,
      enteredQty: item.quantity,
      quantityPieces: requestedPieces,
      unitPricePerPiece: purchasePricePerPiece,
      lineTotal,
    });
  }

  // 5. Execute atomic transaction
  const returnResult = await prisma.$transaction(async (tx) => {
    // Generate unique returnNo safely under concurrent requests
    const counter = await tx.documentCounter.upsert({
      where: {
        pharmacyId_type: {
          pharmacyId,
          type: DocType.PURCHASE_RETURN,
        },
      },
      update: {
        lastNumber: { increment: 1 },
      },
      create: {
        pharmacyId,
        type: DocType.PURCHASE_RETURN,
        lastNumber: 1,
      },
    });

    let currentCounterNumber = counter.lastNumber;
    let returnNo = `PR-${String(currentCounterNumber).padStart(6, "0")}`;

    let collision = await tx.purchaseReturn.findUnique({
      where: {
        pharmacyId_returnNo: {
          pharmacyId,
          returnNo,
        },
      },
    });

    while (collision) {
      currentCounterNumber += 1;
      returnNo = `PR-${String(currentCounterNumber).padStart(6, "0")}`;
      await tx.documentCounter.update({
        where: {
          pharmacyId_type: {
            pharmacyId,
            type: DocType.PURCHASE_RETURN,
          },
        },
        data: {
          lastNumber: currentCounterNumber,
        },
      });
      collision = await tx.purchaseReturn.findUnique({
        where: {
          pharmacyId_returnNo: {
            pharmacyId,
            returnNo,
          },
        },
      });
    }

    // Create PurchaseReturn Header
    const createdReturn = await tx.purchaseReturn.create({
      data: {
        pharmacyId,
        supplierId: purchase.supplierId,
        purchaseId: purchase.id,
        returnNo,
        reason: payload.reason,
        note: payload.note?.trim() || null,
        totalAmount: calculatedTotalReturnAmount,
        createdById: user.id,
      },
    });

    const createdReturnItems = [];

    // Process each return item
    for (const item of processedReturnItems) {
      // Re-verify batch availableQty inside transaction to prevent concurrency races
      const batch = await tx.medicineBatch.findUnique({
        where: { id: item.batchId },
      });

      if (!batch || batch.availableQty < item.quantityPieces) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Return quantity (${item.quantityPieces} pcs) exceeds available stock in batch '${item.batchNo}'.`,
          PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED
        );
      }

      // Re-verify purchase item remaining quantity inside transaction
      const currentPItem = await tx.purchaseItem.findUnique({
        where: { id: item.purchaseItemId },
      });

      if (
        !currentPItem ||
        currentPItem.returnedQtyPieces + item.quantityPieces >
          currentPItem.quantityPieces
      ) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Return quantity exceeds remaining returnable quantity for item '${item.purchaseItemId}'.`,
          PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED
        );
      }

      // Decrement batch available quantity
      const updatedBatch = await tx.medicineBatch.update({
        where: { id: item.batchId },
        data: {
          availableQty: { decrement: item.quantityPieces },
        },
      });

      if (updatedBatch.availableQty < 0) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Stock cannot become negative in batch '${item.batchNo}'.`,
          PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED
        );
      }

      // Increment returnedQtyPieces on PurchaseItem
      await tx.purchaseItem.update({
        where: { id: item.purchaseItemId },
        data: {
          returnedQtyPieces: { increment: item.quantityPieces },
        },
      });

      // Create PurchaseReturnItem record
      const returnItem = await tx.purchaseReturnItem.create({
        data: {
          purchaseReturnId: createdReturn.id,
          purchaseItemId: item.purchaseItemId,
          batchId: item.batchId,
          quantityPieces: item.quantityPieces,
          unitPricePerPiece: item.unitPricePerPiece,
          lineTotal: item.lineTotal,
        },
      });

      // Create StockMovement record with type PURCHASE_RETURN and negative pieces
      await tx.stockMovement.create({
        data: {
          pharmacyId,
          medicineId: item.medicineId,
          batchId: item.batchId,
          type: StockMovementType.PURCHASE_RETURN,
          quantityPieces: -item.quantityPieces,
          balanceAfter: updatedBatch.availableQty,
          refType: "PurchaseReturn",
          refId: createdReturn.id,
          note: payload.note || `Purchase return #${returnNo} (${payload.reason})`,
          createdById: user.id,
        },
      });

      createdReturnItems.push({
        id: returnItem.id,
        purchaseReturnId: returnItem.purchaseReturnId,
        purchaseItemId: returnItem.purchaseItemId,
        batchId: returnItem.batchId,
        batchNo: item.batchNo,
        medicineId: item.medicineId,
        medicineName: item.medicineName,
        quantityPieces: returnItem.quantityPieces,
        unitPricePerPiece: Number(returnItem.unitPricePerPiece),
        lineTotal: Number(returnItem.lineTotal),
      });
    }

    // Decrement supplier due balance (negative balance represents supplier credit)
    const updatedSupplier = await tx.supplier.update({
      where: { id: purchase.supplierId },
      data: {
        dueBalance: { decrement: calculatedTotalReturnAmount },
      },
      select: {
        id: true,
        name: true,
        dueBalance: true,
      },
    });

    // Create AuditLog
    await tx.auditLog.create({
      data: {
        pharmacyId,
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: "PURCHASE_RETURN_CREATED",
        entityType: "PurchaseReturn",
        entityId: createdReturn.id,
        newValue: {
          id: createdReturn.id,
          returnNo,
          purchaseId: purchase.id,
          purchaseInvoiceNo: purchase.invoiceNo,
          supplierId: purchase.supplierId,
          supplierName: purchase.supplier.name,
          reason: payload.reason,
          note: payload.note?.trim() || null,
          totalAmount: calculatedTotalReturnAmount,
          itemCount: processedReturnItems.length,
          items: processedReturnItems.map((i) => ({
            purchaseItemId: i.purchaseItemId,
            medicineId: i.medicineId,
            medicineName: i.medicineName,
            batchId: i.batchId,
            batchNo: i.batchNo,
            quantityPieces: i.quantityPieces,
            unitPricePerPiece: i.unitPricePerPiece,
            lineTotal: i.lineTotal,
          })),
        },
        reason: `Created purchase return #${returnNo} for purchase invoice #${purchase.invoiceNo} (${payload.reason})`,
        ip,
        userAgent,
      },
    });

    return {
      id: createdReturn.id,
      pharmacyId: createdReturn.pharmacyId,
      supplierId: createdReturn.supplierId,
      purchaseId: createdReturn.purchaseId,
      returnNo: createdReturn.returnNo,
      reason: createdReturn.reason,
      note: createdReturn.note,
      totalAmount: Number(createdReturn.totalAmount),
      supplier: {
        id: updatedSupplier.id,
        name: updatedSupplier.name,
        dueBalance: Number(updatedSupplier.dueBalance),
      },
      purchase: {
        id: purchase.id,
        invoiceNo: purchase.invoiceNo,
        purchaseDate: purchase.purchaseDate,
      },
      items: createdReturnItems,
      createdAt: createdReturn.createdAt,
    };
  });

  // 6. Invalidate Redis cache
  await invalidateMedicineCache(pharmacyId);

  return returnResult;
};

export const PurchaseReturnService = {
  getPurchaseReturns,
  getPurchaseReturnById,
  createPurchaseReturn,
};
