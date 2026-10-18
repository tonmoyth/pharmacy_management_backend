import httpStatus from "http-status";
import {
  DocType,
  PharmacyStatus,
  Prisma,
  Role,
  SaleStatus,
  StockMovementType,
  UnitName,
} from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import AppError from "../../../errors/AppError";
import { QueryBuilder } from "../../../utils/queryBuilder";
import {
  SALES_RETURN_ERROR_CODES,
  salesReturnFilterableFields,
  salesReturnSearchableFields,
} from "./sales_returns.constant";
import {
  ICreateSalesReturnPayload,
  IGetSalesReturnsQuery,
  ISalesReturnItemResponse,
  ISalesReturnResponse,
  ISalesReturnUserContext,
} from "./sales_returns.interface";

export const round2 = (val: number): number => {
  return Math.round((val + Number.EPSILON) * 100) / 100;
};

/**
 * Validates that pharmacy exists and is in ACTIVE status.
 */
const validatePharmacyActive = async (pharmacyId: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      area: true,
      invoiceHeader: true,
      invoiceFooter: true,
      status: true,
      maxDiscountPercent: true,
    },
  });

  if (!pharmacy) {
    throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  }

  if (pharmacy.status !== PharmacyStatus.ACTIVE) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      `Pharmacy is not active (Status: ${pharmacy.status}). Return operations are disabled.`
    );
  }

  return pharmacy;
};

/**
 * Create a sales return and atomically restore inventory and customer due.
 */
const createSalesReturn = async (
  pharmacyId: string,
  user: ISalesReturnUserContext,
  payload: ICreateSalesReturnPayload,
  ip?: string,
  userAgent?: string
): Promise<ISalesReturnResponse> => {
  await validatePharmacyActive(pharmacyId);

  // 1. Reason validation
  if (!payload.reason || !payload.reason.trim()) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Return reason cannot be empty"
    );
  }

  // 2. Reject duplicate item entries in the same request
  const seenItems = new Set<string>();
  for (const item of payload.items) {
    if (seenItems.has(item.saleItemId)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Duplicate sale item entry detected for item ID '${item.saleItemId}'. Please combine quantities into a single item entry.`,
        SALES_RETURN_ERROR_CODES.DUPLICATE_ITEM_ENTRY
      );
    }
    seenItems.add(item.saleItemId);
  }

  // 3. Pre-fetch sale to verify pharmacy scope and accessibility
  const existingSale = await prisma.sale.findFirst({
    where: {
      id: payload.saleId,
      pharmacyId,
    },
    include: {
      items: {
        include: {
          medicine: {
            include: {
              units: true,
            },
          },
          batch: true,
        },
      },
      customer: true,
      returns: true,
    },
  });

  if (!existingSale) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Sale not found",
      SALES_RETURN_ERROR_CODES.SALE_NOT_FOUND
    );
  }

  if (existingSale.status === SaleStatus.CANCELLED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cancelled sales cannot be returned",
      SALES_RETURN_ERROR_CODES.SALE_CANCELLED
    );
  }

  // 4. Verify all requested saleItemIds belong to this sale
  const saleItemMap = new Map(existingSale.items.map((i) => [i.id, i]));
  for (const item of payload.items) {
    if (!saleItemMap.has(item.saleItemId)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Sale item '${item.saleItemId}' does not belong to sale '${existingSale.invoiceNo}'`,
        SALES_RETURN_ERROR_CODES.SALE_ITEM_NOT_FOUND
      );
    }
  }

  // 5. Atomic transaction with row-level locks
  const result = await prisma.$transaction(
    async (tx) => {
      // A. Lock Sale row
      const lockedSaleResult = await tx.$queryRaw<
        Array<{
          id: string;
          status: SaleStatus;
          pharmacyId: string;
          invoiceNo: string;
          subtotal: any;
          discountAmount: any;
          totalAmount: any;
          paidAmount: any;
          dueAmount: any;
          customerId: string | null;
        }>
      >`
        SELECT id, status, "pharmacyId", "invoiceNo", subtotal, "discountAmount", "totalAmount", "paidAmount", "dueAmount", "customerId"
        FROM "Sale"
        WHERE id = ${payload.saleId} AND "pharmacyId" = ${pharmacyId}
        FOR UPDATE
      `;

      const lockedSale = lockedSaleResult[0];
      if (!lockedSale) {
        throw new AppError(
          httpStatus.NOT_FOUND,
          "Sale not found",
          SALES_RETURN_ERROR_CODES.SALE_NOT_FOUND
        );
      }

      if (lockedSale.status === SaleStatus.CANCELLED) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "Cancelled sales cannot be returned",
          SALES_RETURN_ERROR_CODES.SALE_CANCELLED
        );
      }

      // B. Lock SaleItem rows in deterministic ID order
      const sortedSaleItemIds = existingSale.items.map((i) => i.id).sort();
      const lockedSaleItems = await tx.$queryRaw<
        Array<{
          id: string;
          saleId: string;
          medicineId: string;
          batchId: string;
          quantityPieces: number;
          returnedQtyPieces: number;
          unitPricePerPiece: any;
          costPricePerPiece: any;
          lineSubtotal: any;
        }>
      >`
        SELECT id, "saleId", "medicineId", "batchId", "quantityPieces", "returnedQtyPieces", "unitPricePerPiece", "costPricePerPiece", "lineSubtotal"
        FROM "SaleItem"
        WHERE id = ANY(${sortedSaleItemIds}::text[])
        ORDER BY id ASC
        FOR UPDATE
      `;

      const lockedSaleItemMap = new Map(lockedSaleItems.map((i) => [i.id, i]));

      // C. Lock affected Batch rows in deterministic ID order
      const affectedBatchIds = Array.from(
        new Set(
          payload.items.map((i) => saleItemMap.get(i.saleItemId)!.batchId)
        )
      ).sort();

      await tx.$queryRaw<
        Array<{
          id: string;
          pharmacyId: string;
          availableQty: number;
        }>
      >`
        SELECT id, "pharmacyId", "availableQty"
        FROM "MedicineBatch"
        WHERE id = ANY(${affectedBatchIds}::text[])
        ORDER BY id ASC
        FOR UPDATE
      `;

      // D. Unit conversion & returnable quantity verification
      const returnPiecesMap = new Map<string, number>();

      for (const item of payload.items) {
        const originalItem = saleItemMap.get(item.saleItemId)!;
        const med = originalItem.medicine;
        const lockedItem = lockedSaleItemMap.get(item.saleItemId)!;

        const unitConfig =
          med.units.find((u) => u.unit === item.unit) ||
          (item.unit === UnitName.PIECE ? { piecesPerUnit: 1 } : null);

        if (!unitConfig) {
          const availableUnits = med.units.map((u) => u.unit).join(", ");
          throw new AppError(
            httpStatus.BAD_REQUEST,
            `Unit '${item.unit}' is not configured for medicine '${med.name}'. Configured units: ${availableUnits || "None"}.`,
            SALES_RETURN_ERROR_CODES.INVALID_UNIT
          );
        }

        const returnPieces = item.quantity * unitConfig.piecesPerUnit;
        const remainingReturnable =
          lockedItem.quantityPieces - lockedItem.returnedQtyPieces;

        if (returnPieces > remainingReturnable) {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            `Requested return quantity (${returnPieces} pieces) exceeds remaining returnable quantity (${remainingReturnable} pieces) for medicine '${med.name}'.`,
            SALES_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED
          );
        }

        returnPiecesMap.set(item.saleItemId, returnPieces);
      }

      // E. Check if this return will make the sale 100% returned (final return)
      let allItemsWillBeFullyReturned = true;
      for (const item of existingSale.items) {
        const lockedItem = lockedSaleItemMap.get(item.id)!;
        const additionalReturnPieces = returnPiecesMap.get(item.id) || 0;
        const totalAfter =
          lockedItem.returnedQtyPieces + additionalReturnPieces;
        if (totalAfter < lockedItem.quantityPieces) {
          allItemsWillBeFullyReturned = false;
          break;
        }
      }
      const isFinalReturn = allItemsWillBeFullyReturned;

      // F. Calculate item refund & discount shares
      const invoiceSubtotal = Number(lockedSale.subtotal);
      const invoiceDiscountAmount = Number(lockedSale.discountAmount);
      const invoiceTotalAmount = Number(lockedSale.totalAmount);

      const priorReturns = await tx.saleReturn.findMany({
        where: { saleId: lockedSale.id },
        select: { discountShare: true, refundAmount: true, itemsAmount: true },
      });

      const priorDiscountAllocated = round2(
        priorReturns.reduce((sum, r) => sum + Number(r.discountShare), 0)
      );
      const priorRefundAllocated = round2(
        priorReturns.reduce((sum, r) => sum + Number(r.refundAmount), 0)
      );

      const returnLines: Array<{
        saleItemId: string;
        batchId: string;
        medicineId: string;
        medicineName: string;
        genericName?: string | null;
        batchNo: string;
        expiryDate: Date;
        quantityPieces: number;
        unitPricePerPiece: number;
        amount: number;
        discountShare: number;
        refundAmount: number;
        originalSoldPieces: number;
        totalReturnedPiecesAfterThis: number;
        remainingReturnablePieces: number;
      }> = [];

      for (const item of payload.items) {
        const originalItem = saleItemMap.get(item.saleItemId)!;
        const lockedItem = lockedSaleItemMap.get(item.saleItemId)!;
        const returnPieces = returnPiecesMap.get(item.saleItemId)!;
        const unitPrice = Number(lockedItem.unitPricePerPiece);
        const amount = round2(returnPieces * unitPrice);

        let discountShare = 0;
        if (invoiceSubtotal > 0 && invoiceDiscountAmount > 0) {
          discountShare = round2(
            amount * (invoiceDiscountAmount / invoiceSubtotal)
          );
        }
        const refundAmount = round2(Math.max(0, amount - discountShare));
        const totalReturnedAfter = lockedItem.returnedQtyPieces + returnPieces;
        const remainingAfter = lockedItem.quantityPieces - totalReturnedAfter;

        returnLines.push({
          saleItemId: item.saleItemId,
          batchId: lockedItem.batchId,
          medicineId: lockedItem.medicineId,
          medicineName: originalItem.medicine.name,
          genericName: originalItem.medicine.genericName,
          batchNo: originalItem.batch.batchNo,
          expiryDate: originalItem.batch.expiryDate,
          quantityPieces: returnPieces,
          unitPricePerPiece: unitPrice,
          amount,
          discountShare,
          refundAmount,
          originalSoldPieces: lockedItem.quantityPieces,
          totalReturnedPiecesAfterThis: totalReturnedAfter,
          remainingReturnablePieces: remainingAfter,
        });
      }

      const totalReturnItemsAmount = round2(
        returnLines.reduce((sum, line) => sum + line.amount, 0)
      );

      let totalReturnDiscountShare = round2(
        returnLines.reduce((sum, line) => sum + line.discountShare, 0)
      );
      let totalReturnRefundAmount = round2(
        returnLines.reduce((sum, line) => sum + line.refundAmount, 0)
      );

      // Final-return rounding reconciliation so sum of all returns strictly reconciles
      if (isFinalReturn && returnLines.length > 0) {
        const exactRemainingDiscount = round2(
          Math.max(0, invoiceDiscountAmount - priorDiscountAllocated)
        );
        const exactRemainingRefund = round2(
          Math.max(0, invoiceTotalAmount - priorRefundAllocated)
        );

        const sumDiscountExceptLast = round2(
          returnLines
            .slice(0, -1)
            .reduce((sum, line) => sum + line.discountShare, 0)
        );
        const sumRefundExceptLast = round2(
          returnLines
            .slice(0, -1)
            .reduce((sum, line) => sum + line.refundAmount, 0)
        );

        const lastIndex = returnLines.length - 1;
        returnLines[lastIndex].discountShare = round2(
          Math.max(0, exactRemainingDiscount - sumDiscountExceptLast)
        );
        returnLines[lastIndex].refundAmount = round2(
          Math.max(0, exactRemainingRefund - sumRefundExceptLast)
        );

        totalReturnDiscountShare = exactRemainingDiscount;
        totalReturnRefundAmount = exactRemainingRefund;
      }

      // G. Allocate refund between due reduction and cash refund
      const remainingInvoiceDue = Number(lockedSale.dueAmount);
      const dueReduced = round2(
        Math.min(totalReturnRefundAmount, remainingInvoiceDue)
      );
      const cashRefunded = round2(
        Math.max(0, totalReturnRefundAmount - dueReduced)
      );

      // H. Unique sequential return number generation
      const counter = await tx.documentCounter.upsert({
        where: {
          pharmacyId_type: {
            pharmacyId,
            type: DocType.SALE_RETURN,
          },
        },
        update: {
          lastNumber: { increment: 1 },
        },
        create: {
          pharmacyId,
          type: DocType.SALE_RETURN,
          lastNumber: 1,
        },
      });

      let currentCounterNumber = counter.lastNumber;
      let returnNo = `SR-${String(currentCounterNumber).padStart(6, "0")}`;

      let collision = await tx.saleReturn.findUnique({
        where: {
          pharmacyId_returnNo: {
            pharmacyId,
            returnNo,
          },
        },
      });

      while (collision) {
        currentCounterNumber += 1;
        returnNo = `SR-${String(currentCounterNumber).padStart(6, "0")}`;
        await tx.documentCounter.update({
          where: {
            pharmacyId_type: {
              pharmacyId,
              type: DocType.SALE_RETURN,
            },
          },
          data: {
            lastNumber: currentCounterNumber,
          },
        });
        collision = await tx.saleReturn.findUnique({
          where: {
            pharmacyId_returnNo: {
              pharmacyId,
              returnNo,
            },
          },
        });
      }

      // I. Persist SaleReturn
      const createdReturn = await tx.saleReturn.create({
        data: {
          pharmacyId,
          saleId: lockedSale.id,
          returnNo,
          reason: payload.reason.trim(),
          itemsAmount: totalReturnItemsAmount,
          discountShare: totalReturnDiscountShare,
          refundAmount: totalReturnRefundAmount,
          dueReduced,
          cashRefunded,
          createdById: user.id,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      });

      // J. Persist SaleReturnItem rows, increment SaleItem returnedQty, restore Batch, write StockMovement
      const createdItems: ISalesReturnItemResponse[] = [];

      for (const line of returnLines) {
        const itemRecord = await tx.saleReturnItem.create({
          data: {
            saleReturnId: createdReturn.id,
            saleItemId: line.saleItemId,
            batchId: line.batchId,
            quantityPieces: line.quantityPieces,
            unitPricePerPiece: line.unitPricePerPiece,
            amount: line.amount,
            discountShare: line.discountShare,
            refundAmount: line.refundAmount,
          },
        });

        await tx.saleItem.update({
          where: { id: line.saleItemId },
          data: {
            returnedQtyPieces: { increment: line.quantityPieces },
          },
        });

        const updatedBatch = await tx.medicineBatch.update({
          where: { id: line.batchId },
          data: {
            availableQty: { increment: line.quantityPieces },
          },
        });

        await tx.stockMovement.create({
          data: {
            pharmacyId,
            medicineId: line.medicineId,
            batchId: line.batchId,
            type: StockMovementType.SALE_RETURN,
            quantityPieces: line.quantityPieces,
            balanceAfter: updatedBatch.availableQty,
            refId: createdReturn.id,
            refType: "SaleReturn",
            note: `Sales return #${returnNo}: ${payload.reason.trim()}`,
            createdById: user.id,
          },
        });

        createdItems.push({
          id: itemRecord.id,
          saleItemId: line.saleItemId,
          medicineId: line.medicineId,
          medicineName: line.medicineName,
          genericName: line.genericName,
          batchId: line.batchId,
          batchNo: line.batchNo,
          expiryDate: line.expiryDate,
          quantityPieces: line.quantityPieces,
          unitPricePerPiece: line.unitPricePerPiece,
          amount: line.amount,
          discountShare: line.discountShare,
          refundAmount: line.refundAmount,
          originalSoldPieces: line.originalSoldPieces,
          totalReturnedPiecesAfterThis: line.totalReturnedPiecesAfterThis,
          remainingReturnablePieces: line.remainingReturnablePieces,
        });
      }

      // K. Update Sale status and dueAmount
      const updatedSaleStatus = isFinalReturn
        ? SaleStatus.RETURNED
        : SaleStatus.PARTIALLY_RETURNED;

      await tx.sale.update({
        where: { id: lockedSale.id },
        data: {
          dueAmount: { decrement: dueReduced },
          status: updatedSaleStatus,
        },
      });

      // L. Update customer due balance if due was reduced
      let customerInfo: ISalesReturnResponse["customer"] = null;
      if (lockedSale.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: lockedSale.customerId },
        });

        if (customer) {
          if (dueReduced > 0) {
            const currentDue = Number(customer.dueBalance);
            const deduct = Math.min(dueReduced, currentDue);
            if (deduct > 0) {
              const updatedCust = await tx.customer.update({
                where: { id: customer.id },
                data: {
                  dueBalance: { decrement: deduct },
                },
              });
              customerInfo = {
                id: updatedCust.id,
                name: updatedCust.name,
                phone: updatedCust.phone,
                dueBalance: Number(updatedCust.dueBalance),
              };
            } else {
              customerInfo = {
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                dueBalance: Number(customer.dueBalance),
              };
            }
          } else {
            customerInfo = {
              id: customer.id,
              name: customer.name,
              phone: customer.phone,
              dueBalance: Number(customer.dueBalance),
            };
          }
        }
      }

      // M. Audit Log
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "SALE_RETURN_CREATED",
          entityType: "SaleReturn",
          entityId: createdReturn.id,
          reason: payload.reason.trim(),
          newValue: {
            returnNo: createdReturn.returnNo,
            saleId: lockedSale.id,
            invoiceNo: lockedSale.invoiceNo,
            itemsAmount: totalReturnItemsAmount,
            discountShare: totalReturnDiscountShare,
            refundAmount: totalReturnRefundAmount,
            dueReduced,
            cashRefunded,
            reason: payload.reason.trim(),
            itemsCount: createdItems.length,
          },
          ip,
          userAgent,
        },
      });

      return {
        id: createdReturn.id,
        pharmacyId: createdReturn.pharmacyId,
        returnNo: createdReturn.returnNo,
        saleId: lockedSale.id,
        invoiceNo: lockedSale.invoiceNo,
        reason: createdReturn.reason,
        itemsAmount: Number(createdReturn.itemsAmount),
        discountShare: Number(createdReturn.discountShare),
        refundAmount: Number(createdReturn.refundAmount),
        dueReduced: Number(createdReturn.dueReduced),
        cashRefunded: Number(createdReturn.cashRefunded),
        createdAt: createdReturn.createdAt,
        createdBy: createdReturn.createdBy,
        customer: customerInfo,
        items: createdItems,
      };
    },
    { timeout: 30000, maxWait: 10000 }
  );

  return result;
};

/**
 * List sales returns with role-based filtering, date range, pagination, and sorting.
 */
const getSalesReturns = async (
  pharmacyId: string,
  user: ISalesReturnUserContext,
  query: IGetSalesReturnsQuery
) => {
  await validatePharmacyActive(pharmacyId);

  const {
    date,
    from: dateFrom,
    to: dateTo,
    saleId,
    createdById,
    ...filterData
  } = query;

  const returnQuery = new QueryBuilder(prisma.saleReturn, filterData, {
    searchableFields: salesReturnSearchableFields,
    filterableFields: salesReturnFilterableFields,
  })
    .search()
    .filter()
    .sort()
    .paginate()
    .include({
      sale: {
        select: {
          id: true,
          invoiceNo: true,
          soldAt: true,
          totalAmount: true,
          dueAmount: true,
          status: true,
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
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

  // Pharmacy tenant isolation
  returnQuery.where({ pharmacyId });

  // Role-based creator restriction
  if (user.role === Role.PHARMACY_OWNER) {
    if (createdById) {
      returnQuery.where({ createdById });
    }
  } else {
    // Cashier and Staff can only see their own returns
    if (createdById && createdById !== user.id) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Cashier and Staff can only view their own sales returns",
        SALES_RETURN_ERROR_CODES.FORBIDDEN_FILTER_PARAM
      );
    }
    returnQuery.where({ createdById: user.id });
  }

  // Filter by source sale
  if (saleId) {
    returnQuery.where({ saleId });
  }

  // Date filtering
  if (date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    returnQuery.where({ createdAt: { gte: start, lte: end } });
  } else if (dateFrom || dateTo) {
    const dateFilter: Record<string, Date> = {};
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      dateFilter.gte = fromDate;
    }
    if (dateTo) {
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
    createdAt: r.createdAt,
    reason: r.reason,
    itemsAmount: Number(r.itemsAmount),
    discountShare: Number(r.discountShare),
    refundAmount: Number(r.refundAmount),
    dueReduced: Number(r.dueReduced),
    cashRefunded: Number(r.cashRefunded),
    sale: {
      id: r.sale?.id,
      invoiceNo: r.sale?.invoiceNo,
      soldAt: r.sale?.soldAt,
      totalAmount: Number(r.sale?.totalAmount || 0),
      dueAmount: Number(r.sale?.dueAmount || 0),
      status: r.sale?.status,
      customer: r.sale?.customer,
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
 * Return detailed sales return information by ID.
 * Strict creator ownership for Cashier/Staff.
 */
const getSalesReturnById = async (
  pharmacyId: string,
  user: ISalesReturnUserContext,
  returnId: string
): Promise<ISalesReturnResponse> => {
  await validatePharmacyActive(pharmacyId);

  const returnRecord = await prisma.saleReturn.findFirst({
    where: {
      id: returnId,
      pharmacyId,
      ...(user.role !== Role.PHARMACY_OWNER ? { createdById: user.id } : {}),
    },
    include: {
      sale: {
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              dueBalance: true,
            },
          },
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
          saleItem: {
            include: {
              medicine: {
                select: {
                  id: true,
                  name: true,
                  genericName: true,
                },
              },
            },
          },
          batch: {
            select: {
              id: true,
              batchNo: true,
              expiryDate: true,
            },
          },
        },
      },
    },
  });

  if (!returnRecord) {
    throw new AppError(httpStatus.NOT_FOUND, "Sales return not found");
  }

  const items: ISalesReturnItemResponse[] = returnRecord.items.map((i) => {
    const saleItem = i.saleItem;
    const originalSoldPieces = saleItem.quantityPieces;
    const currentReturned = saleItem.returnedQtyPieces;
    const remaining = Math.max(0, originalSoldPieces - currentReturned);

    return {
      id: i.id,
      saleItemId: i.saleItemId,
      medicineId: saleItem.medicine.id,
      medicineName: saleItem.medicine.name,
      genericName: saleItem.medicine.genericName,
      batchId: i.batch.id,
      batchNo: i.batch.batchNo,
      expiryDate: i.batch.expiryDate,
      quantityPieces: i.quantityPieces,
      unitPricePerPiece: Number(i.unitPricePerPiece),
      amount: Number(i.amount),
      discountShare: Number(i.discountShare),
      refundAmount: Number(i.refundAmount),
      originalSoldPieces,
      totalReturnedPiecesAfterThis: currentReturned,
      remainingReturnablePieces: remaining,
    };
  });

  return {
    id: returnRecord.id,
    pharmacyId: returnRecord.pharmacyId,
    returnNo: returnRecord.returnNo,
    saleId: returnRecord.saleId,
    invoiceNo: returnRecord.sale.invoiceNo,
    reason: returnRecord.reason,
    itemsAmount: Number(returnRecord.itemsAmount),
    discountShare: Number(returnRecord.discountShare),
    refundAmount: Number(returnRecord.refundAmount),
    dueReduced: Number(returnRecord.dueReduced),
    cashRefunded: Number(returnRecord.cashRefunded),
    createdAt: returnRecord.createdAt,
    createdBy: returnRecord.createdBy,
    customer: returnRecord.sale.customer
      ? {
          id: returnRecord.sale.customer.id,
          name: returnRecord.sale.customer.name,
          phone: returnRecord.sale.customer.phone,
          dueBalance: Number(returnRecord.sale.customer.dueBalance),
        }
      : null,
    items,
  };
};

export const SalesReturnService = {
  createSalesReturn,
  getSalesReturns,
  getSalesReturnById,
};
