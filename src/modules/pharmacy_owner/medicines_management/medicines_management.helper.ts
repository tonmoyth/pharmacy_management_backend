import { UnitName } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { IUnitInput } from "./medicines_management.interface";

export interface IBatchLike {
  id: string;
  pharmacyId?: string;
  medicineId?: string;
  batchNo: string;
  expiryDate: Date | string;
  mrp?: unknown;
  purchasePrice: unknown;
  sellingPrice: unknown;
  receivedQty?: number;
  availableQty: number;
  createdAt: Date | string;
  updatedAt?: Date | string;
}

export interface IMedicineUnitLike {
  id?: string;
  medicineId?: string;
  unit: UnitName;
  piecesPerUnit: number;
}

export interface IUnitBreakdownItem {
  unit: UnitName;
  quantity: number;
  piecesPerUnit: number;
}

export interface IUnitBreakdown {
  totalPieces: number;
  text: string;
  breakdown: IUnitBreakdownItem[];
}

/**
 * Returns current timestamp in Asia/Dhaka timezone (UTC+6).
 */
export const getDhakaNow = (): Date => {
  const now = new Date();
  const dhakaString = now.toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
  return new Date(dhakaString);
};

/**
 * Returns the start of today (00:00:00.000) calculated with Asia/Dhaka timezone.
 */
export const getStartOfTodayDhaka = (): Date => {
  const dhakaNow = getDhakaNow();
  return new Date(
    Date.UTC(
      dhakaNow.getFullYear(),
      dhakaNow.getMonth(),
      dhakaNow.getDate(),
      0,
      0,
      0,
      0
    )
  );
};

/**
 * Backward compatible alias for getStartOfTodayDhaka.
 */
export const getStartOfToday = (): Date => {
  return getStartOfTodayDhaka();
};

/**
 * Returns end of target day (23:59:59.999) after adding the specified number of days from start of today.
 */
export const getExpiryTargetDate = (days: number): Date => {
  const start = getStartOfTodayDhaka();
  const target = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      target.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );
};

/**
 * Interprets a batch's expiry date to find its true effective expiry timestamp
 * (i.e. the final millisecond of the batch's expiry month).
 * Prevents prematurely marking a batch as expired if stored as the 1st of the month.
 */
export const getEffectiveExpiryDate = (date: Date | string): Date => {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  // Day 0 of the next month is the last day of the current month
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
};

/**
 * Evaluates whether a batch is strictly expired relative to the given reference date.
 * A batch is expired only after the entire expiry month has elapsed.
 */
export const isBatchExpired = (
  expiryDate: Date | string,
  referenceDate: Date = getStartOfTodayDhaka()
): boolean => {
  const effectiveExpiry = getEffectiveExpiryDate(expiryDate);
  return effectiveExpiry < referenceDate;
};

/**
 * Parses MM/YYYY formatted string into a Date representing the last day of the expiry month.
 * e.g., "05/2027" -> 2027-05-31T00:00:00.000Z.
 */
export const parseExpiryMMYYYY = (expiryStr: string): Date => {
  const match = expiryStr.trim().match(/^(0[1-9]|1[0-2])\/(\d{4})$/);
  if (!match) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Expiry date must be in MM/YYYY format"
    );
  }

  const month = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);

  // Day 0 of month index (month) gives the last day of (month - 1 + 1) = month
  return new Date(Date.UTC(year, month, 0));
};

/**
 * Normalizes an array of configurable unit conversions:
 * 1. Validates conversion factors as positive integers.
 * 2. Rejects duplicate unit types.
 * 3. Automatically inserts PIECE with factor 1 if omitted.
 * 4. Ensures PIECE always has piecesPerUnit = 1.
 */
export const normalizeUnits = (units?: IUnitInput[]): IUnitInput[] => {
  const normalized: IUnitInput[] = [];
  const seenUnits = new Set<UnitName>();

  if (units && Array.isArray(units)) {
    for (const u of units) {
      if (seenUnits.has(u.unit)) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Duplicate unit '${u.unit}' is not allowed.`
        );
      }

      if (
        !Number.isInteger(u.piecesPerUnit) ||
        Number(u.piecesPerUnit) <= 0
      ) {
        throw new AppError(
          httpStatus.BAD_REQUEST,
          `Unit conversion factor for '${u.unit}' must be a positive integer.`
        );
      }

      seenUnits.add(u.unit);

      if (u.unit === UnitName.PIECE) {
        // PIECE is the base unit and must always have piecesPerUnit = 1
        normalized.push({ unit: UnitName.PIECE, piecesPerUnit: 1 });
      } else {
        normalized.push({
          unit: u.unit,
          piecesPerUnit: Number(u.piecesPerUnit),
        });
      }
    }
  }

  // Ensure PIECE unit is always present with factor 1
  if (!seenUnits.has(UnitName.PIECE)) {
    normalized.push({ unit: UnitName.PIECE, piecesPerUnit: 1 });
  }

  return normalized;
};

/**
 * Determines whether a batch is eligible for sale under FEFO and inventory rules.
 * A batch is eligible if:
 * 1. Available quantity is strictly positive (> 0)
 * 2. Not expired (current date is within or before the expiry month)
 */
export const isBatchEligible = (
  batch: { expiryDate: Date | string; availableQty: number },
  today: Date = getStartOfTodayDhaka()
): boolean => {
  return Number(batch.availableQty) > 0 && !isBatchExpired(batch.expiryDate, today);
};

/**
 * Calculates total available (sellable) stock in base pieces.
 * Excludes expired and depleted batches.
 */
export const calculateAvailableStock = (
  batches: Array<{ expiryDate: Date | string; availableQty: number }>,
  today: Date = getStartOfTodayDhaka()
): number => {
  return batches.reduce((sum, batch) => {
    if (isBatchEligible(batch, today)) {
      return sum + Number(batch.availableQty);
    }
    return sum;
  }, 0);
};

/**
 * Calculates total physical stock in base pieces across all batches,
 * including expired batches that may still physically be present in the pharmacy.
 */
export const calculatePhysicalStock = (
  batches: Array<{ availableQty: number }>
): number => {
  return batches.reduce((sum, batch) => {
    return sum + Math.max(0, Number(batch.availableQty));
  }, 0);
};

/**
 * Selects the earliest-expiring eligible batch (FEFO).
 * - Excludes depleted (availableQty <= 0) and expired batches.
 * - Earliest expiryDate wins.
 * - Deterministic tie-breaker: createdAt ASC, then id ASC.
 */
export const getFefoBatch = <T extends IBatchLike>(
  batches: T[],
  today: Date = getStartOfTodayDhaka()
): T | null => {
  const eligibleBatches = batches.filter((b) => isBatchEligible(b, today));
  if (eligibleBatches.length === 0) {
    return null;
  }

  eligibleBatches.sort((a, b) => {
    const timeA = new Date(a.expiryDate).getTime();
    const timeB = new Date(b.expiryDate).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    const createdA = new Date(a.createdAt).getTime();
    const createdB = new Date(b.createdAt).getTime();
    if (createdA !== createdB) {
      return createdA - createdB;
    }
    return a.id.localeCompare(b.id);
  });

  return eligibleBatches[0];
};

const formatUnitDisplayName = (unit: UnitName): string => {
  switch (unit) {
    case UnitName.BOX:
      return "Box";
    case UnitName.STRIP:
      return "Strip";
    case UnitName.PIECE:
    default:
      return "Piece";
  }
};

/**
 * Calculates the unit breakdown for a given quantity of base pieces
 * using the configured MedicineUnit conversion hierarchy.
 */
export const calculateUnitBreakdown = (
  totalPieces: number,
  units: IMedicineUnitLike[]
): IUnitBreakdown => {
  const pieces = Math.max(0, totalPieces);

  if (units.length === 0) {
    return {
      totalPieces: pieces,
      text: `${pieces} Piece`,
      breakdown: [
        {
          unit: UnitName.PIECE,
          quantity: pieces,
          piecesPerUnit: 1,
        },
      ],
    };
  }

  // Sort descending by piecesPerUnit (e.g. BOX: 100, STRIP: 10, PIECE: 1)
  const sortedUnits = [...units].sort(
    (a, b) => b.piecesPerUnit - a.piecesPerUnit
  );

  let remaining = pieces;
  const breakdown: IUnitBreakdownItem[] = [];
  const textParts: string[] = [];

  for (let i = 0; i < sortedUnits.length; i++) {
    const u = sortedUnits[i];
    const isLast = i === sortedUnits.length - 1;

    if (u.piecesPerUnit > 1 && !isLast) {
      const qty = Math.floor(remaining / u.piecesPerUnit);
      remaining = remaining % u.piecesPerUnit;
      breakdown.push({
        unit: u.unit,
        quantity: qty,
        piecesPerUnit: u.piecesPerUnit,
      });
      if (qty > 0) {
        textParts.push(`${qty} ${formatUnitDisplayName(u.unit)}`);
      }
    } else {
      const divisor = u.piecesPerUnit > 0 ? u.piecesPerUnit : 1;
      const qty = Math.floor(remaining / divisor);
      breakdown.push({
        unit: u.unit,
        quantity: qty,
        piecesPerUnit: u.piecesPerUnit,
      });
      if (qty > 0 || textParts.length === 0) {
        textParts.push(`${qty} ${formatUnitDisplayName(u.unit)}`);
      }
      break;
    }
  }

  return {
    totalPieces: pieces,
    text: textParts.join(", ") || `${pieces} Piece`,
    breakdown,
  };
};

/**
 * Formats batch details for batch lists and medicine detail views.
 */
export const formatBatchSummary = (
  batch: IBatchLike,
  today: Date = getStartOfTodayDhaka()
) => {
  const isExpired = isBatchExpired(batch.expiryDate, today);
  const isDepleted = Number(batch.availableQty) <= 0;
  let status = "ACTIVE";
  if (isExpired) {
    status = "EXPIRED";
  } else if (isDepleted) {
    status = "DEPLETED";
  }

  return {
    id: batch.id,
    pharmacyId: batch.pharmacyId,
    medicineId: batch.medicineId,
    batchNo: batch.batchNo,
    expiryDate: batch.expiryDate,
    mrp: batch.mrp !== null && batch.mrp !== undefined ? Number(batch.mrp) : null,
    purchasePrice: Number(batch.purchasePrice),
    sellingPrice: Number(batch.sellingPrice),
    receivedQty: batch.receivedQty !== undefined ? Number(batch.receivedQty) : 0,
    availableQty: Number(batch.availableQty),
    isExpired,
    isDepleted,
    status,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
};

/**
 * Formats a medicine entity into the standard API response structure.
 */
export const formatMedicineResponse = (
  medicine: any,
  today: Date = getStartOfTodayDhaka()
) => {
  const batches = (medicine.batches || []) as IBatchLike[];
  const units = (medicine.units || []) as IMedicineUnitLike[];

  const totalAvailableStock = calculateAvailableStock(batches, today);
  const totalPhysicalStock = calculatePhysicalStock(batches);
  const unitBreakdown = calculateUnitBreakdown(totalAvailableStock, units);
  const physicalUnitBreakdown = calculateUnitBreakdown(totalPhysicalStock, units);
  const fefoBatch = getFefoBatch(batches, today);
  const sellingPrice = fefoBatch ? Number(fefoBatch.sellingPrice) : null;

  return {
    id: medicine.id,
    pharmacyId: medicine.pharmacyId,
    categoryId: medicine.categoryId,
    name: medicine.name,
    genericName: medicine.genericName,
    company: medicine.company,
    strength: medicine.strength,
    dosageForm: medicine.dosageForm,
    barcode: medicine.barcode,
    minStockLevel: medicine.minStockLevel,
    isPrescriptionRequired: medicine.isPrescriptionRequired,
    status: medicine.status,
    category: medicine.category
      ? {
          id: medicine.category.id,
          name: medicine.category.name,
        }
      : null,
    totalAvailableStock,
    totalPhysicalStock,
    units: units.map((u) => ({
      id: u.id,
      unit: u.unit,
      piecesPerUnit: u.piecesPerUnit,
    })),
    unitBreakdown,
    physicalUnitBreakdown,
    fefoBatch: fefoBatch
      ? {
          id: fefoBatch.id,
          batchNo: fefoBatch.batchNo,
          expiryDate: fefoBatch.expiryDate,
          mrp:
            fefoBatch.mrp !== null && fefoBatch.mrp !== undefined
              ? Number(fefoBatch.mrp)
              : null,
          purchasePrice: Number(fefoBatch.purchasePrice),
          sellingPrice: Number(fefoBatch.sellingPrice),
          availableQty: Number(fefoBatch.availableQty),
        }
      : null,
    sellingPrice,
    createdAt: medicine.createdAt,
    updatedAt: medicine.updatedAt,
  };
};
