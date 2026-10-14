import httpStatus from "http-status";
import { MedicineStatus, StockMovementType } from "@prisma/client";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { redisService } from "../../../utils/cache";
import { QueryBuilder } from "../../../utils/queryBuilder";
import {
  medicineFilterableFields,
  medicineSearchableFields,
} from "./medicines_management.constant";
import {
  formatBatchSummary,
  formatMedicineResponse,
  getExpiryTargetDate,
  getStartOfTodayDhaka,
  normalizeUnits,
  parseExpiryMMYYYY,
} from "./medicines_management.helper";
import {
  ICreateMedicinePayload,
  IMedicineUserContext,
  IQuickAddMedicinePayload,
  IReplaceMedicineUnitsPayload,
  IUpdateMedicinePayload,
} from "./medicines_management.interface";

/**
 * Safely invalidates Redis cache for medicines in this pharmacy.
 */
const invalidateMedicineCache = async (pharmacyId: string): Promise<void> => {
  try {
    await redisService.deleteByPattern(`pharmacy:${pharmacyId}:medicines:*`);
  } catch {
    // Cache failures must never block database transactions
  }
};

/**
 * Create a new Medicine under the authenticated pharmacy.
 * Automatically inserts PIECE = 1 unit conversion.
 */
const createMedicine = async (
  pharmacyId: string,
  user: IMedicineUserContext,
  payload: ICreateMedicinePayload,
  ip?: string,
  userAgent?: string
) => {
  const normalizedBarcode = payload.barcode?.trim() || null;

  if (normalizedBarcode) {
    const existingMedicine = await prisma.medicine.findFirst({
      where: {
        pharmacyId,
        barcode: normalizedBarcode,
      },
    });

    if (existingMedicine) {
      throw new AppError(
        httpStatus.CONFLICT,
        "A medicine with this barcode already exists in your pharmacy."
      );
    }
  }

  if (payload.categoryId) {
    const category = await prisma.category.findFirst({
      where: {
        id: payload.categoryId,
        pharmacyId,
      },
    });

    if (!category) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Category not found in your pharmacy."
      );
    }
  }

  const normalizedUnits = normalizeUnits(payload.units);

  const result = await prisma.$transaction(async (tx) => {
    const newMedicine = await tx.medicine.create({
      data: {
        pharmacyId,
        categoryId: payload.categoryId || null,
        name: payload.name.trim(),
        genericName: payload.genericName?.trim() || null,
        company: payload.company?.trim() || null,
        strength: payload.strength?.trim() || null,
        dosageForm: payload.dosageForm?.trim() || null,
        barcode: normalizedBarcode,
        minStockLevel: payload.minStockLevel ?? 0,
        isPrescriptionRequired: payload.isPrescriptionRequired ?? false,
        status: MedicineStatus.ACTIVE,
        createdById: user.id,
        units: {
          create: normalizedUnits.map((u) => ({
            unit: u.unit,
            piecesPerUnit: u.piecesPerUnit,
          })),
        },
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        units: true,
        batches: true,
      },
    });

    if (user) {
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "MEDICINE_CREATED",
          entityType: "Medicine",
          entityId: newMedicine.id,
          newValue: {
            name: newMedicine.name,
            genericName: newMedicine.genericName,
            barcode: newMedicine.barcode,
            minStockLevel: newMedicine.minStockLevel,
            units: normalizedUnits,
          } as any,
          reason: `Created medicine: ${newMedicine.name}`,
          ip,
          userAgent,
        },
      });
    }

    return newMedicine;
  });

  await invalidateMedicineCache(pharmacyId);

  const today = getStartOfTodayDhaka();
  return formatMedicineResponse(result, today);
};

/**
 * Quick Add Medicine for POS and Purchase workflows.
 * Supports creating initial batch with OPENING_STOCK movement (Flow A)
 * or creating medicine + units only for purchase carts (Flow B).
 */
const quickAddMedicine = async (
  pharmacyId: string,
  user: IMedicineUserContext,
  payload: IQuickAddMedicinePayload,
  ip?: string,
  userAgent?: string
) => {
  const normalizedBarcode = payload.barcode?.trim() || null;

  if (normalizedBarcode) {
    const existingMedicine = await prisma.medicine.findFirst({
      where: {
        pharmacyId,
        barcode: normalizedBarcode,
      },
    });

    if (existingMedicine) {
      throw new AppError(
        httpStatus.CONFLICT,
        "A medicine with this barcode already exists in your pharmacy."
      );
    }
  }

  if (payload.categoryId) {
    const category = await prisma.category.findFirst({
      where: {
        id: payload.categoryId,
        pharmacyId,
      },
    });

    if (!category) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Category not found in your pharmacy."
      );
    }
  }

  const normalizedUnits = normalizeUnits(payload.units);

  let expiryDate: Date | undefined;
  let quantityPieces: number | undefined;

  if (payload.firstBatch) {
    expiryDate = parseExpiryMMYYYY(payload.firstBatch.expiry);

    const unitConfig = normalizedUnits.find(
      (u) => u.unit === payload.firstBatch!.unit
    );

    if (!unitConfig) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Purchase unit '${payload.firstBatch.unit}' is not configured for this medicine.`
      );
    }

    quantityPieces = payload.firstBatch.quantity * unitConfig.piecesPerUnit;
  }

  const result = await prisma.$transaction(async (tx) => {
    const newMedicine = await tx.medicine.create({
      data: {
        pharmacyId,
        categoryId: payload.categoryId || null,
        name: payload.name.trim(),
        genericName: payload.genericName?.trim() || null,
        company: payload.company?.trim() || null,
        strength: payload.strength?.trim() || null,
        dosageForm: payload.dosageForm?.trim() || null,
        barcode: normalizedBarcode,
        minStockLevel: payload.minStockLevel ?? 0,
        isPrescriptionRequired: payload.isPrescriptionRequired ?? false,
        status: MedicineStatus.ACTIVE,
        createdById: user.id,
        units: {
          create: normalizedUnits.map((u) => ({
            unit: u.unit,
            piecesPerUnit: u.piecesPerUnit,
          })),
        },
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        units: true,
        batches: true,
      },
    });

    let createdBatch: any = null;

    if (payload.firstBatch && expiryDate && quantityPieces !== undefined) {
      createdBatch = await tx.medicineBatch.create({
        data: {
          pharmacyId,
          medicineId: newMedicine.id,
          batchNo: payload.firstBatch.batchNo.trim(),
          expiryDate,
          mrp:
            payload.firstBatch.mrp !== undefined &&
            payload.firstBatch.mrp !== null
              ? payload.firstBatch.mrp
              : null,
          purchasePrice: payload.firstBatch.purchasePrice,
          sellingPrice: payload.firstBatch.sellingPrice,
          receivedQty: quantityPieces,
          availableQty: quantityPieces,
        },
      });

      await tx.stockMovement.create({
        data: {
          pharmacyId,
          medicineId: newMedicine.id,
          batchId: createdBatch.id,
          type: StockMovementType.OPENING_STOCK,
          quantityPieces,
          balanceAfter: quantityPieces,
          refType: "OpeningStock",
          refId: createdBatch.id,
          note: "Quick add opening stock",
          createdById: user.id,
        },
      });

      newMedicine.batches = [createdBatch];
    }

    if (user) {
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "MEDICINE_QUICK_ADDED",
          entityType: "Medicine",
          entityId: newMedicine.id,
          newValue: {
            name: newMedicine.name,
            barcode: newMedicine.barcode,
            hasBatch: !!payload.firstBatch,
            batchNo: createdBatch?.batchNo,
            quantityPieces,
            sellingPrice: createdBatch?.sellingPrice,
          } as any,
          reason: `Quick added medicine: ${newMedicine.name}`,
          ip,
          userAgent,
        },
      });
    }

    return newMedicine;
  });

  await invalidateMedicineCache(pharmacyId);

  const today = getStartOfTodayDhaka();
  return formatMedicineResponse(result, today);
};

/**
 * Update editable fields of a medicine.
 * Enforces pharmacy-scoped uniqueness for modified barcodes.
 */
const updateMedicine = async (
  pharmacyId: string,
  id: string,
  user: IMedicineUserContext,
  payload: IUpdateMedicinePayload,
  ip?: string,
  userAgent?: string
) => {
  const existingMedicine = await prisma.medicine.findFirst({
    where: {
      id,
      pharmacyId,
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      units: true,
      batches: {
        where: { pharmacyId },
        orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!existingMedicine) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Medicine not found in your pharmacy"
    );
  }

  if (payload.categoryId) {
    const category = await prisma.category.findFirst({
      where: {
        id: payload.categoryId,
        pharmacyId,
      },
    });

    if (!category) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Category not found in your pharmacy."
      );
    }
  }

  const normalizedBarcode =
    payload.barcode !== undefined
      ? payload.barcode?.trim() || null
      : undefined;

  if (normalizedBarcode && normalizedBarcode !== existingMedicine.barcode) {
    const duplicate = await prisma.medicine.findFirst({
      where: {
        pharmacyId,
        barcode: normalizedBarcode,
        id: { not: id },
      },
    });

    if (duplicate) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Another medicine with this barcode already exists in your pharmacy."
      );
    }
  }

  const updateData: Record<string, unknown> = {};
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};

  if (payload.name !== undefined && payload.name.trim() !== existingMedicine.name) {
    updateData.name = payload.name.trim();
    oldValue.name = existingMedicine.name;
    newValue.name = updateData.name;
  }

  if (
    payload.genericName !== undefined &&
    (payload.genericName?.trim() || null) !== existingMedicine.genericName
  ) {
    updateData.genericName = payload.genericName?.trim() || null;
    oldValue.genericName = existingMedicine.genericName;
    newValue.genericName = updateData.genericName;
  }

  if (
    payload.company !== undefined &&
    (payload.company?.trim() || null) !== existingMedicine.company
  ) {
    updateData.company = payload.company?.trim() || null;
    oldValue.company = existingMedicine.company;
    newValue.company = updateData.company;
  }

  if (
    payload.categoryId !== undefined &&
    (payload.categoryId || null) !== existingMedicine.categoryId
  ) {
    updateData.categoryId = payload.categoryId || null;
    oldValue.categoryId = existingMedicine.categoryId;
    newValue.categoryId = updateData.categoryId;
  }

  if (
    payload.strength !== undefined &&
    (payload.strength?.trim() || null) !== existingMedicine.strength
  ) {
    updateData.strength = payload.strength?.trim() || null;
    oldValue.strength = existingMedicine.strength;
    newValue.strength = updateData.strength;
  }

  if (
    payload.dosageForm !== undefined &&
    (payload.dosageForm?.trim() || null) !== existingMedicine.dosageForm
  ) {
    updateData.dosageForm = payload.dosageForm?.trim() || null;
    oldValue.dosageForm = existingMedicine.dosageForm;
    newValue.dosageForm = updateData.dosageForm;
  }

  if (
    normalizedBarcode !== undefined &&
    normalizedBarcode !== existingMedicine.barcode
  ) {
    updateData.barcode = normalizedBarcode;
    oldValue.barcode = existingMedicine.barcode;
    newValue.barcode = updateData.barcode;
  }

  if (
    payload.minStockLevel !== undefined &&
    payload.minStockLevel !== existingMedicine.minStockLevel
  ) {
    updateData.minStockLevel = payload.minStockLevel;
    oldValue.minStockLevel = existingMedicine.minStockLevel;
    newValue.minStockLevel = updateData.minStockLevel;
  }

  if (
    payload.isPrescriptionRequired !== undefined &&
    payload.isPrescriptionRequired !== existingMedicine.isPrescriptionRequired
  ) {
    updateData.isPrescriptionRequired = payload.isPrescriptionRequired;
    oldValue.isPrescriptionRequired = existingMedicine.isPrescriptionRequired;
    newValue.isPrescriptionRequired = updateData.isPrescriptionRequired;
  }

  // Avoid unnecessary writes if nothing changed
  if (Object.keys(updateData).length === 0) {
    const today = getStartOfTodayDhaka();
    return formatMedicineResponse(existingMedicine, today);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.medicine.update({
      where: { id },
      data: updateData,
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        units: true,
        batches: {
          where: { pharmacyId },
          orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (user) {
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "MEDICINE_UPDATED",
          entityType: "Medicine",
          entityId: id,
          oldValue: oldValue as any,
          newValue: newValue as any,
          reason: `Updated medicine: ${updated.name}`,
          ip,
          userAgent,
        },
      });
    }

    return updated;
  });

  await invalidateMedicineCache(pharmacyId);

  const today = getStartOfTodayDhaka();
  return formatMedicineResponse(result, today);
};

/**
 * Toggle or update medicine status (ACTIVE / INACTIVE).
 * Inactive medicines are excluded from search/POS while preserving all historical data.
 */
const changeMedicineStatus = async (
  pharmacyId: string,
  id: string,
  user: IMedicineUserContext,
  status: MedicineStatus,
  ip?: string,
  userAgent?: string
) => {
  const existingMedicine = await prisma.medicine.findFirst({
    where: {
      id,
      pharmacyId,
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      units: true,
      batches: {
        where: { pharmacyId },
        orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!existingMedicine) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Medicine not found in your pharmacy"
    );
  }

  if (existingMedicine.status === status) {
    const today = getStartOfTodayDhaka();
    return formatMedicineResponse(existingMedicine, today);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.medicine.update({
      where: { id },
      data: { status },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        units: true,
        batches: {
          where: { pharmacyId },
          orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (user) {
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "MEDICINE_STATUS_UPDATED",
          entityType: "Medicine",
          entityId: id,
          oldValue: { status: existingMedicine.status },
          newValue: { status },
          reason: `Status changed from ${existingMedicine.status} to ${status}`,
          ip,
          userAgent,
        },
      });
    }

    return updated;
  });

  await invalidateMedicineCache(pharmacyId);

  const today = getStartOfTodayDhaka();
  return formatMedicineResponse(result, today);
};

/**
 * Replace medicine unit conversion configuration.
 * Strictly prohibited if the medicine already has any stock movements.
 */
const replaceMedicineUnits = async (
  pharmacyId: string,
  id: string,
  user: IMedicineUserContext,
  payload: IReplaceMedicineUnitsPayload,
  ip?: string,
  userAgent?: string
) => {
  const existingMedicine = await prisma.medicine.findFirst({
    where: {
      id,
      pharmacyId,
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      units: true,
      batches: {
        where: { pharmacyId },
        orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!existingMedicine) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Medicine not found in your pharmacy"
    );
  }

  const normalizedUnits = normalizeUnits(payload.units);

  const result = await prisma.$transaction(async (tx) => {
    // Critical inventory integrity rule: prohibited if stock movements exist
    const movementCount = await tx.stockMovement.count({
      where: {
        medicineId: id,
        pharmacyId,
      },
    });

    if (movementCount > 0) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Cannot replace unit conversions because stock movements already exist for this medicine."
      );
    }

    await tx.medicineUnit.deleteMany({
      where: {
        medicineId: id,
      },
    });

    await tx.medicineUnit.createMany({
      data: normalizedUnits.map((u) => ({
        medicineId: id,
        unit: u.unit,
        piecesPerUnit: u.piecesPerUnit,
      })),
    });

    const updated = await tx.medicine.findUniqueOrThrow({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        units: true,
        batches: {
          where: { pharmacyId },
          orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (user) {
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "MEDICINE_UNITS_UPDATED",
          entityType: "Medicine",
          entityId: id,
          oldValue: { units: existingMedicine.units } as any,
          newValue: { units: normalizedUnits } as any,
          reason: `Replaced unit conversions for medicine: ${updated.name}`,
          ip,
          userAgent,
        },
      });
    }

    return updated;
  });

  await invalidateMedicineCache(pharmacyId);

  const today = getStartOfTodayDhaka();
  return formatMedicineResponse(result, today);
};

/**
 * Return paginated batches for a single medicine.
 * Calculates batch status and expiry in Asia/Dhaka timezone.
 */
const getMedicineBatches = async (
  pharmacyId: string,
  id: string,
  query: Record<string, unknown>
) => {
  const medicine = await prisma.medicine.findFirst({
    where: {
      id,
      pharmacyId,
    },
  });

  if (!medicine) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Medicine not found in your pharmacy"
    );
  }

  const normalizedQuery = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
  };

  const batchQuery = new QueryBuilder(
    prisma.medicineBatch,
    normalizedQuery as any,
    {
      searchableFields: ["batchNo"],
      filterableFields: [],
    }
  )
    .search()
    .filter()
    .sort()
    .paginate();

  // Strict tenant and medicine scoping
  batchQuery.where({
    pharmacyId,
    medicineId: id,
  });

  const result = await batchQuery.execute();

  const today = getStartOfTodayDhaka();
  const formattedBatches = result.data.map((batch: any) =>
    formatBatchSummary(batch, today)
  );

  return {
    meta: result.meta,
    data: formattedBatches,
  };
};

/**
 * Retrieve a paginated list of medicines belonging to the authenticated pharmacy.
 */
const getMedicines = async (
  pharmacyId: string,
  query: Record<string, unknown>
) => {
  const today = getStartOfTodayDhaka();

  const normalizedQuery = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
  };

  const medicineQuery = new QueryBuilder(
    prisma.medicine,
    normalizedQuery as any,
    {
      searchableFields: medicineSearchableFields,
      filterableFields: medicineFilterableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate()
    .include({
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      units: true,
      batches: {
        where: { pharmacyId },
        orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      },
    });

  medicineQuery.where({ pharmacyId });

  const isExpired = query.expired === "true" || query.expired === true;
  const days = query.expiringDays ? Number(query.expiringDays) : null;
  const isExpiringValid = days !== null && [30, 60, 90].includes(days);

  if (isExpired && isExpiringValid) {
    const targetDate = getExpiryTargetDate(days);
    medicineQuery.where({
      AND: [
        {
          batches: {
            some: {
              expiryDate: {
                lt: today,
              },
            },
          },
        },
        {
          batches: {
            some: {
              expiryDate: {
                gte: today,
                lte: targetDate,
              },
            },
          },
        },
      ],
    });
  } else if (isExpired) {
    medicineQuery.where({
      batches: {
        some: {
          expiryDate: {
            lt: today,
          },
        },
      },
    });
  } else if (isExpiringValid) {
    const targetDate = getExpiryTargetDate(days);
    medicineQuery.where({
      batches: {
        some: {
          expiryDate: {
            gte: today,
            lte: targetDate,
          },
        },
      },
    });
  }

  const isLowStock = query.lowStock === "true" || query.lowStock === true;
  if (isLowStock) {
    const lowStockResults = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT m.id
      FROM "Medicine" m
      LEFT JOIN "MedicineBatch" b
        ON b."medicineId" = m.id
        AND b."expiryDate" >= ${today}
        AND b."availableQty" > 0
        AND b."pharmacyId" = ${pharmacyId}
      WHERE m."pharmacyId" = ${pharmacyId}
      GROUP BY m.id, m."minStockLevel"
      HAVING COALESCE(SUM(b."availableQty"), 0) < m."minStockLevel"
    `;

    const lowStockIds = lowStockResults.map((row) => row.id);
    medicineQuery.where({
      id: {
        in: lowStockIds,
      },
    });
  }

  const result = await medicineQuery.execute();

  const formattedData = result.data.map((medicine: any) =>
    formatMedicineResponse(medicine, today)
  );

  return {
    meta: result.meta,
    data: formattedData,
  };
};

/**
 * Exact barcode lookup for barcode scanners.
 */
const lookupMedicineByBarcode = async (
  pharmacyId: string,
  barcode: string
) => {
  const normalizedBarcode = barcode.trim();
  const today = getStartOfTodayDhaka();

  const medicine = await prisma.medicine.findFirst({
    where: {
      pharmacyId,
      barcode: normalizedBarcode,
      status: MedicineStatus.ACTIVE,
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      units: true,
      batches: {
        where: { pharmacyId },
        orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!medicine) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Medicine not found with the provided barcode"
    );
  }

  return formatMedicineResponse(medicine, today);
};

/**
 * Fast medicine autocomplete for POS/Purchase screens.
 */
const searchMedicines = async (pharmacyId: string, q: string) => {
  const searchTerm = q.trim();
  if (!searchTerm) {
    return [];
  }

  const today = getStartOfTodayDhaka();

  const medicines = await prisma.medicine.findMany({
    where: {
      pharmacyId,
      status: MedicineStatus.ACTIVE,
      OR: [
        {
          name: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
        {
          genericName: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
      ],
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      units: true,
      batches: {
        where: { pharmacyId },
        orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      },
    },
    take: 20,
    orderBy: [
      { name: "asc" },
      { id: "asc" },
    ],
  });

  return medicines.map((medicine: any) =>
    formatMedicineResponse(medicine, today)
  );
};

/**
 * Return detailed information for a single medicine.
 */
const getMedicineById = async (pharmacyId: string, id: string) => {
  const today = getStartOfTodayDhaka();

  const medicine = await prisma.medicine.findFirst({
    where: {
      id,
      pharmacyId,
    },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
      units: true,
      batches: {
        where: { pharmacyId },
        orderBy: [{ expiryDate: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!medicine) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Medicine not found in your pharmacy"
    );
  }

  const baseResponse = formatMedicineResponse(medicine, today);

  const formattedBatches = (medicine.batches || []).map((batch: any) =>
    formatBatchSummary(batch, today)
  );

  return {
    ...baseResponse,
    batches: formattedBatches,
  };
};

export const MedicinesManagementService = {
  createMedicine,
  quickAddMedicine,
  updateMedicine,
  changeMedicineStatus,
  replaceMedicineUnits,
  getMedicineBatches,
  getMedicines,
  lookupMedicineByBarcode,
  searchMedicines,
  getMedicineById,
};
