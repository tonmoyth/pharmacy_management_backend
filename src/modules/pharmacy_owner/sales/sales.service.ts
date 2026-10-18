import httpStatus from "http-status";
import {
  DiscountType,
  DocType,
  MedicineStatus,
  PayMethod,
  PharmacyStatus,
  Role,
  SaleStatus,
  StockMovementType,
  UnitName,
} from "@prisma/client";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { redisService } from "../../../utils/cache";
import {
  getStartOfTodayDhaka,
  isBatchExpired,
} from "../medicines_management/medicines_management.helper";
import {
  INVOICE_PDF_SIZES,
  InvoicePdfSize,
  SALES_ERROR_CODES,
  SALES_WARNING_CODES,
} from "./sales.constant";
import {
  IAllocatedBatchLine,
  ICancelSalePayload,
  IConfirmSalePayload,
  IConfirmSaleResult,
  IGetSalesQuery,
  IInvoiceItemDetail,
  IInvoiceJSONResult,
  IPreviewSalePayload,
  IPreviewSaleResult,
  ISaleUserContext,
  ISaleWarning,
} from "./sales.interface";
import { formatDhakaDateTime, generateInvoicePDF } from "./sales.pdf";

/**
 * Utility to round monetary values safely to 2 decimal places.
 */
export const round2 = (val: number): number => {
  return Math.round((val + Number.EPSILON) * 100) / 100;
};

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
 * Validate that pharmacy exists and is in ACTIVE status.
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
      `Pharmacy is not active (Status: ${pharmacy.status}). Sales operations are disabled.`
    );
  }

  return pharmacy;
};

/**
 * Reconcile proportional discount shares across item lines using decimal-safe arithmetic.
 */
export const calculateReconciledDiscountShares = (
  items: Array<{ id: string; lineSubtotal: number | string | any }>,
  subtotal: number,
  discountAmount: number
): Map<string, number> => {
  const shares = new Map<string, number>();
  if (items.length === 0 || subtotal <= 0 || discountAmount <= 0) {
    items.forEach((item) => shares.set(item.id, 0));
    return shares;
  }

  let allocatedSum = 0;
  items.forEach((item, index) => {
    const itemSubtotal = round2(Number(item.lineSubtotal));
    if (index === items.length - 1) {
      // Last item absorbs remaining rounding difference
      const finalShare = round2(discountAmount - allocatedSum);
      shares.set(item.id, Math.max(0, finalShare));
    } else {
      const share = round2(discountAmount * (itemSubtotal / subtotal));
      shares.set(item.id, share);
      allocatedSum = round2(allocatedSum + share);
    }
  });

  return shares;
};

/**
 * Preview a sale without modifying any database records (Dry run).
 */
const previewSale = async (
  pharmacyId: string,
  payload: IPreviewSalePayload
): Promise<IPreviewSaleResult> => {
  await validatePharmacyActive(pharmacyId);
  const today = getStartOfTodayDhaka();

  const medicineIds = Array.from(new Set(payload.items.map((i) => i.medicineId)));
  const medicines = await prisma.medicine.findMany({
    where: {
      id: { in: medicineIds },
      pharmacyId,
    },
    include: {
      units: true,
      batches: true,
    },
  });

  if (medicines.length !== medicineIds.length) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "One or more medicines not found in this pharmacy"
    );
  }

  const medicineMap = new Map(medicines.map((m) => [m.id, m]));
  const warnings: ISaleWarning[] = [];

  const batchStockMap = new Map<string, number>();
  for (const med of medicines) {
    for (const b of med.batches) {
      batchStockMap.set(b.id, b.availableQty);
    }
  }

  const allocations: IAllocatedBatchLine[] = [];

  for (const item of payload.items) {
    const med = medicineMap.get(item.medicineId);
    if (!med) {
      throw new AppError(
        httpStatus.NOT_FOUND,
        `Medicine '${item.medicineId}' not found`
      );
    }

    if (med.status !== MedicineStatus.ACTIVE) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Medicine '${med.name}' is inactive and cannot be sold.`
      );
    }

    if (med.isPrescriptionRequired) {
      const alreadyWarned = warnings.some(
        (w) =>
          w.code === SALES_WARNING_CODES.PRESCRIPTION_REQUIRED &&
          w.medicineId === med.id
      );
      if (!alreadyWarned) {
        warnings.push({
          code: SALES_WARNING_CODES.PRESCRIPTION_REQUIRED,
          message: `Medicine '${med.name}' requires a doctor's prescription.`,
          medicineId: med.id,
        });
      }
    }

    const unitConfig =
      med.units.find((u) => u.unit === item.unit) ||
      (item.unit === UnitName.PIECE ? { piecesPerUnit: 1 } : null);

    if (!unitConfig) {
      const availableUnits = med.units.map((u) => u.unit).join(", ");
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Unit '${item.unit}' is not configured for medicine '${med.name}'. Configured units: ${availableUnits || "None"}.`
      );
    }

    const piecesPerUnit = unitConfig.piecesPerUnit;
    const requestedPieces = item.quantity * piecesPerUnit;

    if (item.batchId) {
      const batch = med.batches.find((b) => b.id === item.batchId);
      if (!batch) {
        throw new AppError(
          httpStatus.NOT_FOUND,
          `Batch '${item.batchId}' not found for medicine '${med.name}'`
        );
      }

      if (isBatchExpired(batch.expiryDate, today)) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Selected batch '${batch.batchNo}' for medicine '${med.name}' has expired.`,
          SALES_ERROR_CODES.EXPIRED_BATCH
        );
      }

      const availableInBatch = batchStockMap.get(batch.id) || 0;
      if (availableInBatch < requestedPieces) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Insufficient stock in selected batch '${batch.batchNo}'. Requested: ${requestedPieces} pieces, available: ${availableInBatch} pieces.`,
          SALES_ERROR_CODES.INSUFFICIENT_STOCK
        );
      }

      batchStockMap.set(batch.id, availableInBatch - requestedPieces);
      const unitPrice = Number(batch.sellingPrice);
      const costPrice = Number(batch.purchasePrice);
      const lineSubtotal = round2(requestedPieces * unitPrice);

      allocations.push({
        medicineId: med.id,
        medicineName: med.name,
        genericName: med.genericName,
        batchId: batch.id,
        batchNo: batch.batchNo,
        expiryDate: batch.expiryDate,
        enteredUnit: item.unit,
        enteredQty: item.quantity,
        quantityPieces: requestedPieces,
        unitPricePerPiece: unitPrice,
        costPricePerPiece: costPrice,
        lineSubtotal,
      });
    } else {
      const candidateBatches = med.batches
        .filter((b) => {
          const avail = batchStockMap.get(b.id) || 0;
          return avail > 0 && !isBatchExpired(b.expiryDate, today);
        })
        .sort((a, b) => {
          const timeA = new Date(a.expiryDate).getTime();
          const timeB = new Date(b.expiryDate).getTime();
          if (timeA !== timeB) return timeA - timeB;
          const createdA = new Date(a.createdAt).getTime();
          const createdB = new Date(b.createdAt).getTime();
          if (createdA !== createdB) return createdA - createdB;
          return a.id.localeCompare(b.id);
        });

      const totalSellable = candidateBatches.reduce(
        (sum, b) => sum + (batchStockMap.get(b.id) || 0),
        0
      );

      if (totalSellable < requestedPieces) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Insufficient stock for medicine '${med.name}'. Requested: ${requestedPieces} pieces, available: ${totalSellable} pieces.`,
          SALES_ERROR_CODES.INSUFFICIENT_STOCK
        );
      }

      let remainingPieces = requestedPieces;
      for (const batch of candidateBatches) {
        if (remainingPieces <= 0) break;
        const availableInBatch = batchStockMap.get(batch.id) || 0;
        if (availableInBatch <= 0) continue;

        const take = Math.min(remainingPieces, availableInBatch);
        batchStockMap.set(batch.id, availableInBatch - take);
        remainingPieces -= take;

        const unitPrice = Number(batch.sellingPrice);
        const costPrice = Number(batch.purchasePrice);
        const lineSubtotal = round2(take * unitPrice);

        let allocUnit = item.unit;
        let allocQty = take;
        if (take % piecesPerUnit === 0) {
          allocQty = take / piecesPerUnit;
          allocUnit = item.unit;
        } else {
          allocUnit = UnitName.PIECE;
          allocQty = take;
        }

        allocations.push({
          medicineId: med.id,
          medicineName: med.name,
          genericName: med.genericName,
          batchId: batch.id,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
          enteredUnit: allocUnit,
          enteredQty: allocQty,
          quantityPieces: take,
          unitPricePerPiece: unitPrice,
          costPricePerPiece: costPrice,
          lineSubtotal,
        });
      }
    }
  }

  const subtotal = round2(
    allocations.reduce((sum, line) => sum + line.lineSubtotal, 0)
  );

  let discountType: DiscountType = DiscountType.NONE;
  let discountValue = 0;
  let discountAmount = 0;

  if (payload.discount && payload.discount.value > 0) {
    discountType = payload.discount.type;
    discountValue = round2(payload.discount.value);

    if (discountType === DiscountType.PERCENT) {
      discountAmount = round2(subtotal * (discountValue / 100));
    } else if (discountType === DiscountType.FIXED) {
      discountAmount = Math.min(subtotal, discountValue);
    }
  }

  const totalAmount = round2(Math.max(0, subtotal - discountAmount));

  if (payload.customerId) {
    const customer = await prisma.customer.findFirst({
      where: {
        id: payload.customerId,
        pharmacyId,
      },
    });

    if (customer && customer.creditLimit !== null) {
      const currentDue = Number(customer.dueBalance);
      const creditLimit = Number(customer.creditLimit);
      if (currentDue + totalAmount > creditLimit) {
        warnings.push({
          code: SALES_WARNING_CODES.CREDIT_LIMIT_EXCEEDED,
          message: `Customer '${customer.name}' has credit limit of ${creditLimit.toFixed(2)} BDT. Proposed total will exceed this limit.`,
          customerId: customer.id,
        });
      }
    }
  }

  return {
    allocations,
    subtotal,
    discount: {
      type: discountType,
      value: discountValue,
      discountAmount,
    },
    totalAmount,
    warnings,
  };
};

/**
 * Confirm and persist a sale in an atomic database transaction.
 */
const confirmSale = async (
  pharmacyId: string,
  user: ISaleUserContext,
  payload: IConfirmSalePayload,
  ip?: string,
  userAgent?: string
): Promise<IConfirmSaleResult> => {
  const pharmacy = await validatePharmacyActive(pharmacyId);
  const today = getStartOfTodayDhaka();

  let customer: any = null;
  if (payload.customerId) {
    customer = await prisma.customer.findFirst({
      where: {
        id: payload.customerId,
        pharmacyId,
      },
    });

    if (!customer) {
      throw new AppError(httpStatus.NOT_FOUND, "Customer not found");
    }

    if (!customer.isActive) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Customer '${customer.name}' is inactive and cannot be billed.`
      );
    }
  }

  const sortedMedicineIds = Array.from(
    new Set(payload.items.map((i) => i.medicineId))
  ).sort();

  const medicines = await prisma.medicine.findMany({
    where: {
      id: { in: sortedMedicineIds },
      pharmacyId,
    },
    include: {
      units: true,
    },
  });

  if (medicines.length !== sortedMedicineIds.length) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "One or more medicines not found in this pharmacy"
    );
  }

  const medicineMap = new Map(medicines.map((m) => [m.id, m]));
  for (const med of medicines) {
    if (med.status !== MedicineStatus.ACTIVE) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Medicine '${med.name}' is inactive and cannot be sold.`
      );
    }
  }

  const warnings: ISaleWarning[] = [];
  for (const med of medicines) {
    if (med.isPrescriptionRequired) {
      warnings.push({
        code: SALES_WARNING_CODES.PRESCRIPTION_REQUIRED,
        message: `Medicine '${med.name}' requires a doctor's prescription.`,
        medicineId: med.id,
      });
    }
  }

  const result = await prisma.$transaction(
    async (tx) => {
      // Row-level lock on candidate batches
      const lockedBatches = await tx.$queryRaw<
        Array<{
          id: string;
          medicineId: string;
          batchNo: string;
          expiryDate: Date;
          purchasePrice: any;
          sellingPrice: any;
          availableQty: number;
          createdAt: Date;
        }>
      >`
        SELECT id, "medicineId", "batchNo", "expiryDate", "purchasePrice", "sellingPrice", "availableQty", "createdAt"
        FROM "MedicineBatch"
        WHERE "pharmacyId" = ${pharmacyId}
          AND "medicineId" = ANY(${sortedMedicineIds}::text[])
        ORDER BY "expiryDate" ASC, id ASC
        FOR UPDATE
      `;

      const batchMap = new Map<string, (typeof lockedBatches)[0]>();
      const batchStockMap = new Map<string, number>();

      for (const b of lockedBatches) {
        batchMap.set(b.id, b);
        batchStockMap.set(b.id, Number(b.availableQty));
      }

      const allocations: IAllocatedBatchLine[] = [];

      for (const item of payload.items) {
        const med = medicineMap.get(item.medicineId)!;
        const unitConfig =
          med.units.find((u) => u.unit === item.unit) ||
          (item.unit === UnitName.PIECE ? { piecesPerUnit: 1 } : null);

        if (!unitConfig) {
          const availableUnits = med.units.map((u) => u.unit).join(", ");
          throw new AppError(
            httpStatus.BAD_REQUEST,
            `Unit '${item.unit}' is not configured for medicine '${med.name}'. Configured units: ${availableUnits || "None"}.`
          );
        }

        const piecesPerUnit = unitConfig.piecesPerUnit;
        const requestedPieces = item.quantity * piecesPerUnit;

        if (item.batchId) {
          const batch = batchMap.get(item.batchId);
          if (!batch || batch.medicineId !== med.id) {
            throw new AppError(
              httpStatus.NOT_FOUND,
              `Batch '${item.batchId}' not found for medicine '${med.name}'`
            );
          }

          if (isBatchExpired(batch.expiryDate, today)) {
            throw new AppError(
              httpStatus.BAD_REQUEST,
              `Selected batch '${batch.batchNo}' for medicine '${med.name}' has expired.`,
              SALES_ERROR_CODES.EXPIRED_BATCH
            );
          }

          const availableInBatch = batchStockMap.get(batch.id) || 0;
          if (availableInBatch < requestedPieces) {
            throw new AppError(
              httpStatus.BAD_REQUEST,
              `Insufficient stock in selected batch '${batch.batchNo}'. Requested: ${requestedPieces} pieces, available: ${availableInBatch} pieces.`,
              SALES_ERROR_CODES.INSUFFICIENT_STOCK
            );
          }

          batchStockMap.set(batch.id, availableInBatch - requestedPieces);
          const unitPrice = Number(batch.sellingPrice);
          const costPrice = Number(batch.purchasePrice);
          const lineSubtotal = round2(requestedPieces * unitPrice);

          allocations.push({
            medicineId: med.id,
            medicineName: med.name,
            genericName: med.genericName,
            batchId: batch.id,
            batchNo: batch.batchNo,
            expiryDate: batch.expiryDate,
            enteredUnit: item.unit,
            enteredQty: item.quantity,
            quantityPieces: requestedPieces,
            unitPricePerPiece: unitPrice,
            costPricePerPiece: costPrice,
            lineSubtotal,
          });
        } else {
          const candidateBatches = lockedBatches
            .filter((b) => {
              if (b.medicineId !== med.id) return false;
              const avail = batchStockMap.get(b.id) || 0;
              return avail > 0 && !isBatchExpired(b.expiryDate, today);
            })
            .sort((a, b) => {
              const timeA = new Date(a.expiryDate).getTime();
              const timeB = new Date(b.expiryDate).getTime();
              if (timeA !== timeB) return timeA - timeB;
              const createdA = new Date(a.createdAt).getTime();
              const createdB = new Date(b.createdAt).getTime();
              if (createdA !== createdB) return createdA - createdB;
              return a.id.localeCompare(b.id);
            });

          const totalSellable = candidateBatches.reduce(
            (sum, b) => sum + (batchStockMap.get(b.id) || 0),
            0
          );

          if (totalSellable < requestedPieces) {
            throw new AppError(
              httpStatus.BAD_REQUEST,
              `Insufficient stock for medicine '${med.name}'. Requested: ${requestedPieces} pieces, available: ${totalSellable} pieces.`,
              SALES_ERROR_CODES.INSUFFICIENT_STOCK
            );
          }

          let remainingPieces = requestedPieces;
          for (const batch of candidateBatches) {
            if (remainingPieces <= 0) break;
            const availableInBatch = batchStockMap.get(batch.id) || 0;
            if (availableInBatch <= 0) continue;

            const take = Math.min(remainingPieces, availableInBatch);
            batchStockMap.set(batch.id, availableInBatch - take);
            remainingPieces -= take;

            const unitPrice = Number(batch.sellingPrice);
            const costPrice = Number(batch.purchasePrice);
            const lineSubtotal = round2(take * unitPrice);

            let allocUnit = item.unit;
            let allocQty = take;
            if (take % piecesPerUnit === 0) {
              allocQty = take / piecesPerUnit;
              allocUnit = item.unit;
            } else {
              allocUnit = UnitName.PIECE;
              allocQty = take;
            }

            allocations.push({
              medicineId: med.id,
              medicineName: med.name,
              genericName: med.genericName,
              batchId: batch.id,
              batchNo: batch.batchNo,
              expiryDate: batch.expiryDate,
              enteredUnit: allocUnit,
              enteredQty: allocQty,
              quantityPieces: take,
              unitPricePerPiece: unitPrice,
              costPricePerPiece: costPrice,
              lineSubtotal,
            });
          }
        }
      }

      const subtotal = round2(
        allocations.reduce((sum, line) => sum + line.lineSubtotal, 0)
      );

      let discountType: DiscountType = DiscountType.NONE;
      let discountValue = 0;
      let discountAmount = 0;

      if (payload.discount && payload.discount.value > 0) {
        discountType = payload.discount.type;
        discountValue = round2(payload.discount.value);

        if (discountType === DiscountType.PERCENT) {
          discountAmount = round2(subtotal * (discountValue / 100));
        } else if (discountType === DiscountType.FIXED) {
          discountAmount = Math.min(subtotal, discountValue);
        }
      }

      const totalAmount = round2(Math.max(0, subtotal - discountAmount));

      if (
        (user.role === Role.CASHIER || user.role === Role.STAFF) &&
        discountAmount > 0
      ) {
        const allowedMaxPercent = Number(pharmacy.maxDiscountPercent || 0);
        let effectivePercent = 0;

        if (discountType === DiscountType.PERCENT) {
          effectivePercent = discountValue;
        } else if (discountType === DiscountType.FIXED) {
          effectivePercent = subtotal > 0 ? round2((discountAmount / subtotal) * 100) : 0;
        }

        if (effectivePercent > allowedMaxPercent) {
          throw new AppError(
            httpStatus.FORBIDDEN,
            `Discount of ${effectivePercent}% exceeds your pharmacy's maximum allowed limit of ${allowedMaxPercent}%.`,
            SALES_ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED
          );
        }
      }

      const paidAmount = round2(payload.paidAmount);
      if (paidAmount < 0) {
        throw new AppError(httpStatus.BAD_REQUEST, "Paid amount cannot be negative");
      }

      if (paidAmount > totalAmount) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Paid amount (${paidAmount.toFixed(2)} BDT) cannot exceed final payable total (${totalAmount.toFixed(2)} BDT).`
        );
      }

      const dueAmount = round2(totalAmount - paidAmount);

      if (dueAmount > 0) {
        if (!payload.customerId) {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            "Customer selection is required when there is an unpaid due amount.",
            SALES_ERROR_CODES.CUSTOMER_REQUIRED_FOR_DUE
          );
        }

        if (customer && customer.creditLimit !== null) {
          const currentDue = Number(customer.dueBalance);
          const creditLimit = Number(customer.creditLimit);
          const newDue = round2(currentDue + dueAmount);

          if (newDue > creditLimit) {
            warnings.push({
              code: SALES_WARNING_CODES.CREDIT_LIMIT_EXCEEDED,
              message: `Customer '${customer.name}' credit limit of ${creditLimit.toFixed(2)} BDT is exceeded with new due balance of ${newDue.toFixed(2)} BDT.`,
              customerId: customer.id,
            });
          }
        }
      }

      const counter = await tx.documentCounter.upsert({
        where: {
          pharmacyId_type: {
            pharmacyId,
            type: DocType.SALE,
          },
        },
        update: {
          lastNumber: { increment: 1 },
        },
        create: {
          pharmacyId,
          type: DocType.SALE,
          lastNumber: 1,
        },
      });

      let currentCounterNumber = counter.lastNumber;
      let invoiceNo = `INV-${String(currentCounterNumber).padStart(6, "0")}`;

      let collision = await tx.sale.findUnique({
        where: {
          pharmacyId_invoiceNo: {
            pharmacyId,
            invoiceNo,
          },
        },
      });

      while (collision) {
        currentCounterNumber += 1;
        invoiceNo = `INV-${String(currentCounterNumber).padStart(6, "0")}`;
        await tx.documentCounter.update({
          where: {
            pharmacyId_type: {
              pharmacyId,
              type: DocType.SALE,
            },
          },
          data: {
            lastNumber: currentCounterNumber,
          },
        });
        collision = await tx.sale.findUnique({
          where: {
            pharmacyId_invoiceNo: {
              pharmacyId,
              invoiceNo,
            },
          },
        });
      }

      const sale = await tx.sale.create({
        data: {
          pharmacyId,
          invoiceSeq: currentCounterNumber,
          invoiceNo,
          customerId: payload.customerId || null,
          subtotal,
          discountType,
          discountValue,
          discountAmount,
          totalAmount,
          paidAmount,
          dueAmount,
          paymentMethod: payload.paymentMethod || PayMethod.CASH,
          status: SaleStatus.COMPLETED,
          note: payload.note?.trim() || null,
          createdById: user.id,
        },
      });

      for (const alloc of allocations) {
        const updatedBatch = await tx.medicineBatch.update({
          where: { id: alloc.batchId },
          data: {
            availableQty: { decrement: alloc.quantityPieces },
          },
        });

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            medicineId: alloc.medicineId,
            batchId: alloc.batchId,
            enteredUnit: alloc.enteredUnit,
            enteredQty: alloc.enteredQty,
            quantityPieces: alloc.quantityPieces,
            unitPricePerPiece: alloc.unitPricePerPiece,
            costPricePerPiece: alloc.costPricePerPiece || 0,
            lineSubtotal: alloc.lineSubtotal,
          },
        });

        await tx.stockMovement.create({
          data: {
            pharmacyId,
            medicineId: alloc.medicineId,
            batchId: alloc.batchId,
            type: StockMovementType.SALE,
            quantityPieces: -alloc.quantityPieces,
            balanceAfter: updatedBatch.availableQty,
            refType: "Sale",
            refId: sale.id,
            note: `Sale invoice #${sale.invoiceNo} (${alloc.quantityPieces} pieces)`,
            createdById: user.id,
          },
        });
      }

      if (dueAmount > 0 && payload.customerId) {
        await tx.customer.update({
          where: { id: payload.customerId },
          data: {
            dueBalance: { increment: dueAmount },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "SALE_CREATED",
          entityType: "Sale",
          entityId: sale.id,
          newValue: {
            id: sale.id,
            invoiceNo: sale.invoiceNo,
            customerId: sale.customerId,
            subtotal,
            discountAmount,
            totalAmount,
            paidAmount,
            dueAmount,
            itemCount: allocations.length,
          },
          reason: `Created sale invoice #${sale.invoiceNo}`,
          ip,
          userAgent,
        },
      });

      return {
        sale: {
          ...sale,
          subtotal: Number(sale.subtotal),
          discountValue: Number(sale.discountValue),
          discountAmount: Number(sale.discountAmount),
          totalAmount: Number(sale.totalAmount),
          paidAmount: Number(sale.paidAmount),
          dueAmount: Number(sale.dueAmount),
        },
        items: allocations,
        warnings,
      };
    },
    {
      timeout: 30000,
      maxWait: 10000,
    }
  );

  await invalidateMedicineCache(pharmacyId);
  return result;
};

/**
 * List sales for the authenticated pharmacy with role-based filtering.
 * - Owner: sees all sales, can filter by createdById.
 * - Cashier & Staff: see only their own sales.
 */
const getSales = async (
  pharmacyId: string,
  user: ISaleUserContext,
  query: IGetSalesQuery
) => {
  await validatePharmacyActive(pharmacyId);

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const sortBy = query.sortBy || "soldAt";
  const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

  // Build where filter
  const where: Record<string, unknown> = {
    pharmacyId,
  };

  // Ownership filtering
  if (user.role === Role.PHARMACY_OWNER) {
    if (query.createdById) {
      where.createdById = query.createdById;
    }
  } else {
    // Cashier and Staff: strictly restricted to their own sales
    if (query.createdById && query.createdById !== user.id) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Cashier and Staff can only view their own sales."
      );
    }
    where.createdById = user.id;
  }

  // Date range filtering
  if (query.from || query.to) {
    const dateFilter: Record<string, Date> = {};
    if (query.from) dateFilter.gte = new Date(query.from);
    if (query.to) dateFilter.lte = new Date(query.to);
    where.soldAt = dateFilter;
  }

  // Invoice number search
  if (query.invoiceNo) {
    where.invoiceNo = {
      contains: query.invoiceNo.trim(),
      mode: "insensitive",
    };
  }

  // Medicine filter
  if (query.medicineId) {
    where.items = {
      some: {
        medicineId: query.medicineId,
      },
    };
  }

  // Customer filter
  if (query.customerId) {
    where.customerId = query.customerId;
  }

  // Payment status filter (derived from dueAmount)
  if (query.paymentStatus === "paid") {
    where.dueAmount = { lte: 0 };
  } else if (query.paymentStatus === "due") {
    where.dueAmount = { gt: 0 };
  }

  // Status filter
  if (query.status) {
    where.status = query.status;
  }

  const [total, sales] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        _count: {
          select: {
            items: true,
            returns: true,
          },
        },
      },
    }),
  ]);

  const formattedSales = sales.map((s) => ({
    id: s.id,
    invoiceNo: s.invoiceNo,
    invoiceSeq: s.invoiceSeq,
    soldAt: s.soldAt,
    status: s.status,
    subtotal: Number(s.subtotal),
    discountType: s.discountType,
    discountValue: Number(s.discountValue),
    discountAmount: Number(s.discountAmount),
    totalAmount: Number(s.totalAmount),
    paidAmount: Number(s.paidAmount),
    dueAmount: Number(s.dueAmount),
    paymentMethod: s.paymentMethod,
    note: s.note,
    cancelReason: s.cancelReason,
    cancelledAt: s.cancelledAt,
    cancelRefundAmount: s.cancelRefundAmount !== null ? Number(s.cancelRefundAmount) : null,
    customer: s.customer,
    createdBy: s.createdBy,
    itemCount: s._count.items,
    returnCount: s._count.returns,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    data: formattedSales,
  };
};

/**
 * Find any invoice by its invoice number within the authenticated pharmacy.
 * Exception: Owner, Cashier, and Staff may look up any invoice in their own pharmacy.
 */
const getSaleByInvoiceNo = async (
  pharmacyId: string,
  user: ISaleUserContext,
  invoiceNo: string
) => {
  await validatePharmacyActive(pharmacyId);

  const sale = await prisma.sale.findFirst({
    where: {
      pharmacyId,
      invoiceNo: invoiceNo.trim(),
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          dueBalance: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      cancelledBy: {
        select: {
          id: true,
          name: true,
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
              strength: true,
              dosageForm: true,
            },
          },
          batch: {
            select: {
              id: true,
              batchNo: true,
              expiryDate: true,
            },
          },
          returnItems: {
            select: {
              quantityPieces: true,
            },
          },
        },
      },
      returns: {
        select: {
          id: true,
          returnNo: true,
          refundAmount: true,
          createdAt: true,
        },
      },
    },
  });

  if (!sale) {
    throw new AppError(httpStatus.NOT_FOUND, "Invoice not found in this pharmacy");
  }

  const subtotal = Number(sale.subtotal);
  const discountAmount = Number(sale.discountAmount);

  // Compute reconciled discount share per line
  const discountShares = calculateReconciledDiscountShares(
    sale.items.map((i) => ({ id: i.id, lineSubtotal: Number(i.lineSubtotal) })),
    subtotal,
    discountAmount
  );

  const formattedItems: IInvoiceItemDetail[] = sale.items.map((i) => {
    const originalSoldPieces = i.quantityPieces;
    const returnedPieces = Math.max(
      i.returnedQtyPieces,
      i.returnItems.reduce((acc, r) => acc + r.quantityPieces, 0)
    );
    const returnableQuantity = Math.max(0, originalSoldPieces - returnedPieces);
    const lineDiscountShare = discountShares.get(i.id) || 0;
    const lineTotal = round2(Number(i.lineSubtotal) - lineDiscountShare);

    const isOwner = user.role === Role.PHARMACY_OWNER;

    return {
      saleItemId: i.id,
      medicineId: i.medicineId,
      medicineName: i.medicine.name,
      genericName: i.medicine.genericName,
      strength: i.medicine.strength,
      dosageForm: i.medicine.dosageForm,
      batchId: i.batchId,
      batchNo: i.batch.batchNo,
      expiryDate: i.batch.expiryDate,
      enteredUnit: i.enteredUnit,
      enteredQty: i.enteredQty,
      quantityPieces: originalSoldPieces,
      unitPricePerPiece: Number(i.unitPricePerPiece),
      ...(isOwner ? { costPricePerPiece: Number(i.costPricePerPiece) } : {}),
      lineSubtotal: Number(i.lineSubtotal),
      discountShare: lineDiscountShare,
      lineTotal,
      returnedQtyPieces: returnedPieces,
      returnableQuantity,
    };
  });

  return {
    id: sale.id,
    pharmacyId: sale.pharmacyId,
    invoiceNo: sale.invoiceNo,
    invoiceSeq: sale.invoiceSeq,
    soldAt: sale.soldAt,
    status: sale.status,
    subtotal,
    discountType: sale.discountType,
    discountValue: Number(sale.discountValue),
    discountAmount,
    totalAmount: Number(sale.totalAmount),
    paidAmount: Number(sale.paidAmount),
    dueAmount: Number(sale.dueAmount),
    paymentMethod: sale.paymentMethod,
    note: sale.note,
    cancelReason: sale.cancelReason,
    cancelledAt: sale.cancelledAt,
    cancelledById: sale.cancelledById,
    cancelRefundAmount:
      sale.cancelRefundAmount !== null ? Number(sale.cancelRefundAmount) : null,
    customer: sale.customer
      ? {
          ...sale.customer,
          dueBalance: Number(sale.customer.dueBalance),
        }
      : null,
    createdBy: sale.createdBy,
    cancelledBy: sale.cancelledBy,
    items: formattedItems,
    returns: sale.returns.map((r) => ({
      id: r.id,
      returnNo: r.returnNo,
      refundAmount: Number(r.refundAmount),
      createdAt: r.createdAt,
    })),
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
  };
};

/**
 * Get detailed sale by ID.
 * Strict ownership: Cashier and Staff can view only their own sales.
 */
const getSaleById = async (
  pharmacyId: string,
  user: ISaleUserContext,
  saleId: string
) => {
  await validatePharmacyActive(pharmacyId);

  const where: Record<string, unknown> = {
    id: saleId,
    pharmacyId,
  };

  if (user.role !== Role.PHARMACY_OWNER) {
    where.createdById = user.id;
  }

  const sale = await prisma.sale.findFirst({
    where,
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          dueBalance: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      cancelledBy: {
        select: {
          id: true,
          name: true,
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
              strength: true,
              dosageForm: true,
            },
          },
          batch: {
            select: {
              id: true,
              batchNo: true,
              expiryDate: true,
            },
          },
          returnItems: true,
        },
      },
      returns: {
        select: {
          id: true,
          returnNo: true,
          refundAmount: true,
          createdAt: true,
        },
      },
    },
  });

  if (!sale) {
    throw new AppError(httpStatus.NOT_FOUND, "Sale not found");
  }

  const subtotal = Number(sale.subtotal);
  const discountAmount = Number(sale.discountAmount);

  const discountShares = calculateReconciledDiscountShares(
    sale.items.map((i) => ({ id: i.id, lineSubtotal: Number(i.lineSubtotal) })),
    subtotal,
    discountAmount
  );

  const isOwner = user.role === Role.PHARMACY_OWNER;

  const formattedItems = sale.items.map((i) => {
    const originalSoldPieces = i.quantityPieces;
    const returnedPieces = Math.max(
      i.returnedQtyPieces,
      i.returnItems.reduce((acc, r) => acc + r.quantityPieces, 0)
    );
    const returnableQuantity = Math.max(0, originalSoldPieces - returnedPieces);
    const lineDiscountShare = discountShares.get(i.id) || 0;
    const lineTotal = round2(Number(i.lineSubtotal) - lineDiscountShare);

    return {
      id: i.id,
      medicineId: i.medicineId,
      medicineName: i.medicine.name,
      genericName: i.medicine.genericName,
      strength: i.medicine.strength,
      dosageForm: i.medicine.dosageForm,
      batchId: i.batchId,
      batchNo: i.batch.batchNo,
      expiryDate: i.batch.expiryDate,
      enteredUnit: i.enteredUnit,
      enteredQty: i.enteredQty,
      quantityPieces: originalSoldPieces,
      unitPricePerPiece: Number(i.unitPricePerPiece),
      ...(isOwner ? { costPricePerPiece: Number(i.costPricePerPiece) } : {}),
      lineSubtotal: Number(i.lineSubtotal),
      discountShare: lineDiscountShare,
      lineTotal,
      returnedQtyPieces: returnedPieces,
      returnableQuantity,
    };
  });

  return {
    id: sale.id,
    pharmacyId: sale.pharmacyId,
    invoiceNo: sale.invoiceNo,
    invoiceSeq: sale.invoiceSeq,
    soldAt: sale.soldAt,
    status: sale.status,
    subtotal,
    discountType: sale.discountType,
    discountValue: Number(sale.discountValue),
    discountAmount,
    totalAmount: Number(sale.totalAmount),
    paidAmount: Number(sale.paidAmount),
    dueAmount: Number(sale.dueAmount),
    paymentMethod: sale.paymentMethod,
    note: sale.note,
    cancelReason: sale.cancelReason,
    cancelledAt: sale.cancelledAt,
    cancelledById: sale.cancelledById,
    cancelRefundAmount:
      sale.cancelRefundAmount !== null ? Number(sale.cancelRefundAmount) : null,
    customer: sale.customer
      ? {
          ...sale.customer,
          dueBalance: Number(sale.customer.dueBalance),
        }
      : null,
    createdBy: sale.createdBy,
    cancelledBy: sale.cancelledBy,
    items: formattedItems,
    returns: sale.returns.map((r) => ({
      id: r.id,
      returnNo: r.returnNo,
      refundAmount: Number(r.refundAmount),
      createdAt: r.createdAt,
    })),
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
  };
};

/**
 * Return structured invoice JSON representation.
 * Strict creator ownership applies for Cashier and Staff.
 */
const getSaleInvoiceJSON = async (
  pharmacyId: string,
  user: ISaleUserContext,
  saleId: string
): Promise<IInvoiceJSONResult> => {
  const pharmacy = await validatePharmacyActive(pharmacyId);

  const where: Record<string, unknown> = {
    id: saleId,
    pharmacyId,
  };

  if (user.role !== Role.PHARMACY_OWNER) {
    where.createdById = user.id;
  }

  const sale = await prisma.sale.findFirst({
    where,
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      cancelledBy: {
        select: {
          id: true,
          name: true,
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
              strength: true,
              dosageForm: true,
            },
          },
          batch: {
            select: {
              id: true,
              batchNo: true,
              expiryDate: true,
            },
          },
          returnItems: true,
        },
      },
    },
  });

  if (!sale) {
    throw new AppError(httpStatus.NOT_FOUND, "Sale not found");
  }

  const subtotal = Number(sale.subtotal);
  const discountAmount = Number(sale.discountAmount);

  const discountShares = calculateReconciledDiscountShares(
    sale.items.map((i) => ({ id: i.id, lineSubtotal: Number(i.lineSubtotal) })),
    subtotal,
    discountAmount
  );

  const isOwner = user.role === Role.PHARMACY_OWNER;

  const items: IInvoiceItemDetail[] = sale.items.map((i) => {
    const originalSoldPieces = i.quantityPieces;
    const returnedPieces = Math.max(
      i.returnedQtyPieces,
      i.returnItems.reduce((acc, r) => acc + r.quantityPieces, 0)
    );
    const returnableQuantity = Math.max(0, originalSoldPieces - returnedPieces);
    const lineDiscountShare = discountShares.get(i.id) || 0;
    const lineTotal = round2(Number(i.lineSubtotal) - lineDiscountShare);

    return {
      saleItemId: i.id,
      medicineId: i.medicineId,
      medicineName: i.medicine.name,
      genericName: i.medicine.genericName,
      strength: i.medicine.strength,
      dosageForm: i.medicine.dosageForm,
      batchId: i.batchId,
      batchNo: i.batch.batchNo,
      expiryDate: i.batch.expiryDate,
      enteredUnit: i.enteredUnit,
      enteredQty: i.enteredQty,
      quantityPieces: originalSoldPieces,
      unitPricePerPiece: Number(i.unitPricePerPiece),
      ...(isOwner ? { costPricePerPiece: Number(i.costPricePerPiece) } : {}),
      lineSubtotal: Number(i.lineSubtotal),
      discountShare: lineDiscountShare,
      lineTotal,
      returnedQtyPieces: returnedPieces,
      returnableQuantity,
    };
  });

  return {
    pharmacy: {
      id: pharmacy.id,
      name: pharmacy.name,
      phone: pharmacy.phone,
      email: pharmacy.email,
      address: pharmacy.address,
      city: pharmacy.city,
      area: pharmacy.area,
      invoiceHeader: pharmacy.invoiceHeader,
      invoiceFooter: pharmacy.invoiceFooter,
    },
    sale: {
      id: sale.id,
      invoiceNo: sale.invoiceNo,
      invoiceSeq: sale.invoiceSeq,
      soldAt: sale.soldAt.toISOString(),
      status: sale.status,
      paymentMethod: sale.paymentMethod,
      subtotal,
      discountType: sale.discountType,
      discountValue: Number(sale.discountValue),
      discountAmount,
      totalAmount: Number(sale.totalAmount),
      paidAmount: Number(sale.paidAmount),
      dueAmount: Number(sale.dueAmount),
      note: sale.note,
      cancelReason: sale.cancelReason,
      cancelledAt: sale.cancelledAt?.toISOString() || null,
      cancelRefundAmount:
        sale.cancelRefundAmount !== null ? Number(sale.cancelRefundAmount) : null,
    },
    customer: sale.customer,
    createdBy: sale.createdBy,
    cancelledBy: sale.cancelledBy,
    items,
  };
};

/**
 * Generate invoice PDF buffer.
 */
const getSaleInvoicePDF = async (
  pharmacyId: string,
  user: ISaleUserContext,
  saleId: string,
  size: InvoicePdfSize = "a4"
): Promise<{ buffer: Buffer; invoiceNo: string }> => {
  if (size !== "a4" && size !== "thermal80") {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Invalid paper size. Must be 'a4' or 'thermal80'"
    );
  }

  const invoiceData = await getSaleInvoiceJSON(pharmacyId, user, saleId);
  const buffer = await generateInvoicePDF(invoiceData, size);

  return {
    buffer,
    invoiceNo: invoiceData.sale.invoiceNo,
  };
};

/**
 * Cancel a sale atomically.
 * Restores batch stock, reverses customer due, and records cancellation audit log.
 */
const cancelSale = async (
  pharmacyId: string,
  user: ISaleUserContext,
  saleId: string,
  payload: ICancelSalePayload,
  ip?: string,
  userAgent?: string
) => {
  if (!payload.reason || !payload.reason.trim()) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cancellation reason cannot be empty"
    );
  }

  if (payload.reason.length > 500) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cancellation reason cannot exceed 500 characters"
    );
  }

  await validatePharmacyActive(pharmacyId);

  // 1. Initial check & creator ownership verification
  const existingSale = await prisma.sale.findFirst({
    where: {
      id: saleId,
      pharmacyId,
      ...(user.role !== Role.PHARMACY_OWNER ? { createdById: user.id } : {}),
    },
    include: {
      returns: true,
      items: true,
    },
  });

  if (!existingSale) {
    throw new AppError(httpStatus.NOT_FOUND, "Sale not found");
  }

  if (existingSale.status === SaleStatus.CANCELLED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Sale has already been cancelled",
      SALES_ERROR_CODES.SALE_ALREADY_CANCELLED
    );
  }

  if (existingSale.returns && existingSale.returns.length > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Sale cannot be cancelled because it has return records. Return processing must be handled through the return module.",
      SALES_ERROR_CODES.SALE_HAS_RETURNS
    );
  }

  // 2. Atomic transaction with row locking
  const result = await prisma.$transaction(
    async (tx) => {
      // Lock the Sale row
      const lockedSales = await tx.$queryRaw<
        Array<{
          id: string;
          status: SaleStatus;
          dueAmount: any;
          paidAmount: any;
          customerId: string | null;
          invoiceNo: string;
        }>
      >`
        SELECT id, status, "dueAmount", "paidAmount", "customerId", "invoiceNo"
        FROM "Sale"
        WHERE id = ${saleId} AND "pharmacyId" = ${pharmacyId}
        FOR UPDATE
      `;

      if (lockedSales.length === 0) {
        throw new AppError(httpStatus.NOT_FOUND, "Sale not found");
      }

      const lockedSale = lockedSales[0];
      if (lockedSale.status === SaleStatus.CANCELLED) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          "Sale has already been cancelled",
          SALES_ERROR_CODES.SALE_ALREADY_CANCELLED
        );
      }

      // Re-verify no returns occurred concurrently
      const returnCount = await tx.saleReturn.count({
        where: { saleId },
      });
      if (returnCount > 0) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Sale cannot be cancelled because it has return records. Return processing must be handled through the return module.",
          SALES_ERROR_CODES.SALE_HAS_RETURNS
        );
      }

      const saleItems = await tx.saleItem.findMany({
        where: { saleId },
      });

      // Lock affected batch rows in deterministic order
      const batchIds = Array.from(new Set(saleItems.map((i) => i.batchId))).sort();
      const lockedBatches = await tx.$queryRaw<
        Array<{ id: string; availableQty: number }>
      >`
        SELECT id, "availableQty"
        FROM "MedicineBatch"
        WHERE id = ANY(${batchIds}::text[])
        ORDER BY id ASC
        FOR UPDATE
      `;

      const batchMap = new Map(lockedBatches.map((b) => [b.id, b]));

      // Restore batch stock and create StockMovements
      for (const item of saleItems) {
        const batch = batchMap.get(item.batchId);
        const previousQty = batch ? Number(batch.availableQty) : 0;
        const newBalance = previousQty + item.quantityPieces;

        await tx.medicineBatch.update({
          where: { id: item.batchId },
          data: {
            availableQty: { increment: item.quantityPieces },
          },
        });

        if (batch) {
          batch.availableQty = newBalance;
        }

        await tx.stockMovement.create({
          data: {
            pharmacyId,
            medicineId: item.medicineId,
            batchId: item.batchId,
            type: StockMovementType.SALE_CANCEL,
            quantityPieces: item.quantityPieces, // positive restored quantity
            balanceAfter: newBalance,
            refType: "Sale",
            refId: saleId,
            note: `Cancelled sale invoice #${lockedSale.invoiceNo} (restored ${item.quantityPieces} pieces): ${payload.reason}`,
            createdById: user.id,
          },
        });
      }

      // Adjust customer outstanding due balance
      const dueToAdjust = Number(lockedSale.dueAmount);
      if (lockedSale.customerId && dueToAdjust > 0) {
        const customer = await tx.customer.findUnique({
          where: { id: lockedSale.customerId },
        });

        if (customer) {
          const currentDue = Number(customer.dueBalance);
          const deductAmount = Math.min(currentDue, dueToAdjust);
          if (deductAmount > 0) {
            await tx.customer.update({
              where: { id: lockedSale.customerId },
              data: {
                dueBalance: { decrement: deductAmount },
              },
            });
          }
        }
      }

      const cancelRefundAmount = Number(lockedSale.paidAmount);

      // Update Sale record
      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          status: SaleStatus.CANCELLED,
          cancelReason: payload.reason.trim(),
          cancelledAt: new Date(),
          cancelledById: user.id,
          cancelRefundAmount,
          dueAmount: 0,
        },
      });

      // Write AuditLog
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "SALE_CANCELLED",
          entityType: "Sale",
          entityId: saleId,
          newValue: {
            id: saleId,
            invoiceNo: lockedSale.invoiceNo,
            cancelRefundAmount,
            cancelReason: payload.reason.trim(),
          },
          reason: `Cancelled sale invoice #${lockedSale.invoiceNo}: ${payload.reason.trim()}`,
          ip,
          userAgent,
        },
      });

      return {
        ...updatedSale,
        subtotal: Number(updatedSale.subtotal),
        discountValue: Number(updatedSale.discountValue),
        discountAmount: Number(updatedSale.discountAmount),
        totalAmount: Number(updatedSale.totalAmount),
        paidAmount: Number(updatedSale.paidAmount),
        dueAmount: Number(updatedSale.dueAmount),
        cancelRefundAmount: Number(updatedSale.cancelRefundAmount),
      };
    },
    {
      timeout: 30000,
      maxWait: 10000,
    }
  );

  await invalidateMedicineCache(pharmacyId);
  return result;
};

export const SalesService = {
  previewSale,
  confirmSale,
  getSales,
  getSaleByInvoiceNo,
  getSaleById,
  getSaleInvoiceJSON,
  getSaleInvoicePDF,
  cancelSale,
};
