import httpStatus from "http-status";
import {
  DuplicateMode,
  ImportStatus,
  ImportType,
  MedicineStatus,
  StockMovementType,
  UnitName,
} from "@prisma/client";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { redisService } from "../../../utils/cache";
import { QueryBuilder } from "../../../utils/queryBuilder";
import {
  importFilterableFields,
  importSearchableFields,
} from "./excel_csv_import.constant";
import {
  generateTemplateBuffer,
  getRowValue,
  normalizeMedicineKey,
  parseAndValidateExpiry,
  parseUploadedSpreadsheet,
} from "./excel_csv_import.parser";
import {
  IImportJobData,
  IImportRowError,
  IImportSkippedRow,
  IImportSummary,
  IImportUserContext,
  IImportValidationResult,
  IValidatedMedicineRow,
  IValidatedOpeningStockRow,
} from "./excel_csv_import.interface";

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
 * Service to generate and return template buffer.
 */
const getTemplate = (
  type: "medicines" | "opening-stock"
): { buffer: Buffer; fileName: string; contentType: string } => {
  const buffer = generateTemplateBuffer(type);
  const fileName =
    type === "medicines"
      ? "medicines_import_template.xlsx"
      : "opening_stock_import_template.xlsx";
  const contentType =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  return { buffer, fileName, contentType };
};

/**
 * Validates an uploaded spreadsheet for medicines or opening-stock.
 * Creates an ImportJob with VALIDATED or FAILED status without altering inventory data.
 */
const validateImport = async (
  pharmacyId: string,
  user: IImportUserContext,
  fileBuffer: Buffer,
  fileName: string,
  importTypeRaw: "medicines" | "opening-stock",
  duplicateModeRaw: "skip" | "update"
): Promise<IImportValidationResult> => {
  const parsed = parseUploadedSpreadsheet(fileBuffer, fileName);

  const importType =
    importTypeRaw === "medicines"
      ? ImportType.MEDICINES
      : ImportType.OPENING_STOCK;
  const duplicateMode =
    duplicateModeRaw === "update" ? DuplicateMode.UPDATE : DuplicateMode.SKIP;

  const errors: IImportRowError[] = [];
  const skipped: IImportSkippedRow[] = [];
  const validMedicineRows: IValidatedMedicineRow[] = [];
  const validOpeningStockRows: IValidatedOpeningStockRow[] = [];

  if (parsed.totalRows === 0) {
    errors.push({
      row: 1,
      message: "The uploaded file contains no data rows to import.",
    });
  }

  if (importType === ImportType.MEDICINES) {
    // Preload pharmacy medicines, categories, and barcodes
    const existingMedicines = await prisma.medicine.findMany({
      where: { pharmacyId },
      include: { units: true, category: true },
    });

    const existingMedMap = new Map<string, (typeof existingMedicines)[0]>();
    const existingBarcodeMap = new Map<string, (typeof existingMedicines)[0]>();

    for (const med of existingMedicines) {
      const key = normalizeMedicineKey(med.name, med.strength, med.dosageForm);
      existingMedMap.set(key, med);
      if (med.barcode) {
        existingBarcodeMap.set(med.barcode.trim().toLowerCase(), med);
      }
    }

    const seenInFileKeys = new Map<string, number>();
    const seenInFileBarcodes = new Map<string, number>();

    for (const row of parsed.rows) {
      const rowNum = row.rowNumber;
      const data = row.sanitized;

      // 1. Validate Name
      const nameVal = getRowValue(data, ["Name", "Medicine Name"]);
      const name = typeof nameVal === "string" ? nameVal.trim() : "";

      if (!name) {
        errors.push({
          row: rowNum,
          field: "Name",
          message: "Medicine Name is required.",
        });
        continue;
      }

      // 2. Optional text fields
      const genericNameVal = getRowValue(data, ["Generic Name", "Generic"]);
      const genericName =
        typeof genericNameVal === "string" && genericNameVal.trim()
          ? genericNameVal.trim()
          : null;

      const companyVal = getRowValue(data, ["Company", "Manufacturer"]);
      const company =
        typeof companyVal === "string" && companyVal.trim()
          ? companyVal.trim()
          : null;

      const categoryVal = getRowValue(data, ["Category", "Category Name"]);
      const categoryName =
        typeof categoryVal === "string" && categoryVal.trim()
          ? categoryVal.trim()
          : null;

      const strengthVal = getRowValue(data, ["Strength"]);
      const strength =
        typeof strengthVal === "string" && strengthVal.trim()
          ? strengthVal.trim()
          : null;

      const dosageFormVal = getRowValue(data, [
        "Dosage Form",
        "DosageForm",
        "Form",
      ]);
      const dosageForm =
        typeof dosageFormVal === "string" && dosageFormVal.trim()
          ? dosageFormVal.trim()
          : null;

      const barcodeVal = getRowValue(data, ["Barcode", "Barcode Number"]);
      const barcode =
        typeof barcodeVal === "string" && barcodeVal.trim()
          ? barcodeVal.trim()
          : null;

      // 3. Numeric fields
      const minStockVal = getRowValue(data, [
        "Min Stock Level",
        "MinStockLevel",
        "Min Stock",
      ]);
      let minStockLevel = 0;
      if (minStockVal !== undefined && minStockVal !== "") {
        const parsedMin = Number(minStockVal);
        if (!Number.isInteger(parsedMin) || parsedMin < 0) {
          errors.push({
            row: rowNum,
            field: "Min Stock Level",
            message: "Min Stock Level must be a non-negative integer.",
          });
        } else {
          minStockLevel = parsedMin;
        }
      }

      const rxVal = getRowValue(data, [
        "Prescription Required",
        "isPrescriptionRequired",
        "Rx",
      ]);
      let isPrescriptionRequired = false;
      if (rxVal !== undefined && rxVal !== "") {
        const strRx = String(rxVal).trim().toLowerCase();
        isPrescriptionRequired =
          strRx === "yes" || strRx === "true" || strRx === "1";
      }

      // 4. Units conversion factors
      const stripFactorVal = getRowValue(data, [
        "Strip Factor",
        "Strip Size",
        "Pieces Per Strip",
      ]);
      const boxFactorVal = getRowValue(data, [
        "Box Factor",
        "Box Size",
        "Pieces Per Box",
      ]);

      const units: { unit: UnitName; piecesPerUnit: number }[] = [
        { unit: UnitName.PIECE, piecesPerUnit: 1 },
      ];

      if (stripFactorVal !== undefined && stripFactorVal !== "") {
        const factor = Number(stripFactorVal);
        if (!Number.isInteger(factor) || factor <= 0) {
          errors.push({
            row: rowNum,
            field: "Strip Factor",
            message: "Strip Factor must be a positive integer greater than 0.",
          });
        } else {
          units.push({ unit: UnitName.STRIP, piecesPerUnit: factor });
        }
      }

      if (boxFactorVal !== undefined && boxFactorVal !== "") {
        const factor = Number(boxFactorVal);
        if (!Number.isInteger(factor) || factor <= 0) {
          errors.push({
            row: rowNum,
            field: "Box Factor",
            message: "Box Factor must be a positive integer greater than 0.",
          });
        } else {
          units.push({ unit: UnitName.BOX, piecesPerUnit: factor });
        }
      }

      // Check Barcode uniqueness
      if (barcode) {
        const normBarcode = barcode.toLowerCase();
        if (seenInFileBarcodes.has(normBarcode)) {
          errors.push({
            row: rowNum,
            field: "Barcode",
            message: `Barcode '${barcode}' is duplicated within this file (first seen at row ${seenInFileBarcodes.get(normBarcode)}).`,
          });
        } else {
          seenInFileBarcodes.set(normBarcode, rowNum);
        }

        const dbBarcodeMed = existingBarcodeMap.get(normBarcode);
        const compKey = normalizeMedicineKey(name, strength, dosageForm);
        if (dbBarcodeMed) {
          const dbMedKey = normalizeMedicineKey(
            dbBarcodeMed.name,
            dbBarcodeMed.strength,
            dbBarcodeMed.dosageForm
          );
          if (dbMedKey !== compKey) {
            errors.push({
              row: rowNum,
              field: "Barcode",
              message: `Barcode '${barcode}' already belongs to another medicine ('${dbBarcodeMed.name}') in your pharmacy.`,
            });
          }
        }
      }

      // 5. Duplicate Medicine detection by `Name + Strength + DosageForm`
      const medKey = normalizeMedicineKey(name, strength, dosageForm);
      const existingInDb = existingMedMap.get(medKey);

      if (seenInFileKeys.has(medKey)) {
        const firstSeenRow = seenInFileKeys.get(medKey);
        if (duplicateMode === DuplicateMode.SKIP) {
          skipped.push({
            row: rowNum,
            reason: `Duplicate medicine definition within file (already defined at row ${firstSeenRow})`,
            data: { name, strength, dosageForm },
          });
          continue;
        } else {
          errors.push({
            row: rowNum,
            field: "Name",
            message: `Duplicate medicine definition within file (matches row ${firstSeenRow}). Update mode does not permit conflicting multiple definitions of the same medicine in a single upload.`,
          });
          continue;
        }
      }

      seenInFileKeys.set(medKey, rowNum);

      let action: "CREATE" | "UPDATE" | "SKIP" = "CREATE";
      let targetMedicineId: string | undefined = undefined;

      if (existingInDb) {
        if (duplicateMode === DuplicateMode.SKIP) {
          skipped.push({
            row: rowNum,
            reason:
              "Medicine already exists in pharmacy (duplicateMode is skip)",
            data: { name, strength, dosageForm },
          });
          continue;
        } else {
          action = "UPDATE";
          targetMedicineId = existingInDb.id;
        }
      }

      validMedicineRows.push({
        rowNumber: rowNum,
        action,
        targetMedicineId,
        name,
        genericName,
        company,
        categoryName,
        strength,
        dosageForm,
        barcode,
        minStockLevel,
        isPrescriptionRequired,
        units,
      });
    }
  } else {
    // type === OPENING_STOCK
    const existingMedicines = await prisma.medicine.findMany({
      where: { pharmacyId },
      include: { units: true, batches: true },
    });

    const existingMedMap = new Map<string, (typeof existingMedicines)[0]>();
    const existingBarcodeMap = new Map<string, (typeof existingMedicines)[0]>();

    for (const med of existingMedicines) {
      const key = normalizeMedicineKey(med.name, med.strength, med.dosageForm);
      existingMedMap.set(key, med);
      if (med.barcode) {
        existingBarcodeMap.set(med.barcode.trim().toLowerCase(), med);
      }
    }

    const seenBatchesInFile = new Map<string, number>();

    for (const row of parsed.rows) {
      const rowNum = row.rowNumber;
      const data = row.sanitized;

      // 1. Identify Medicine
      const nameVal = getRowValue(data, ["Name", "Medicine Name"]);
      const name = typeof nameVal === "string" ? nameVal.trim() : "";

      if (!name) {
        errors.push({
          row: rowNum,
          field: "Name",
          message: "Medicine Name is required.",
        });
        continue;
      }

      const strengthVal = getRowValue(data, ["Strength"]);
      const strength =
        typeof strengthVal === "string" && strengthVal.trim()
          ? strengthVal.trim()
          : null;

      const dosageFormVal = getRowValue(data, [
        "Dosage Form",
        "DosageForm",
        "Form",
      ]);
      const dosageForm =
        typeof dosageFormVal === "string" && dosageFormVal.trim()
          ? dosageFormVal.trim()
          : null;

      const barcodeVal = getRowValue(data, ["Barcode", "Barcode Number"]);
      const barcode =
        typeof barcodeVal === "string" && barcodeVal.trim()
          ? barcodeVal.trim()
          : null;

      // Resolve Medicine in Pharmacy
      const medKey = normalizeMedicineKey(name, strength, dosageForm);
      let matchedMedicine = existingMedMap.get(medKey);

      if (!matchedMedicine && barcode) {
        matchedMedicine = existingBarcodeMap.get(barcode.toLowerCase());
      }

      if (!matchedMedicine) {
        errors.push({
          row: rowNum,
          field: "Medicine",
          message: `Medicine '${name}' (${strength || "N/A"}, ${dosageForm || "N/A"}) does not exist in your pharmacy. Please import or create the medicine first.`,
        });
        continue;
      }

      // 2. Batch No
      const batchNoVal = getRowValue(data, [
        "Batch No",
        "Batch Number",
        "Batch",
      ]);
      const batchNo = typeof batchNoVal === "string" ? batchNoVal.trim() : "";

      if (!batchNo) {
        errors.push({
          row: rowNum,
          field: "Batch No",
          message: "Batch number is required.",
        });
        continue;
      }

      // 3. Expiry Date
      const expiryVal = getRowValue(data, [
        "Expiry Date",
        "Expiry",
        "Exp Date",
      ]);
      let expiryDate: Date | null = null;
      try {
        const parsedExpiry = parseAndValidateExpiry(expiryVal, rowNum);
        expiryDate = parsedExpiry.expiryDate;
      } catch (err: any) {
        errors.push({
          row: rowNum,
          field: "Expiry Date",
          message: err.message,
        });
        continue;
      }

      // 4. Unit
      const unitVal = getRowValue(data, ["Unit"]);
      const unitStr =
        typeof unitVal === "string" ? unitVal.trim().toUpperCase() : "";

      if (!unitStr || !Object.values(UnitName).includes(unitStr as UnitName)) {
        errors.push({
          row: rowNum,
          field: "Unit",
          message: `Unit must be one of: ${Object.values(UnitName).join(", ")}. Received: '${unitStr || "empty"}'.`,
        });
        continue;
      }

      const unit = unitStr as UnitName;

      // Check if unit is configured for this medicine
      const unitConfig = matchedMedicine.units.find((u) => u.unit === unit);
      if (!unitConfig) {
        const availableUnits = matchedMedicine.units
          .map((u) => u.unit)
          .join(", ");
        errors.push({
          row: rowNum,
          field: "Unit",
          message: `Unit '${unit}' is not configured for medicine '${matchedMedicine.name}'. Configured units: ${availableUnits || "PIECE"}.`,
        });
        continue;
      }

      // 5. Quantity
      const qtyVal = getRowValue(data, ["Quantity", "Qty"]);
      const quantity = Number(qtyVal);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        errors.push({
          row: rowNum,
          field: "Quantity",
          message: "Quantity must be a positive integer greater than 0.",
        });
        continue;
      }

      // 6. Prices
      const purchasePriceVal = getRowValue(data, [
        "Purchase Price",
        "Cost Price",
        "Purchase Price (Per Piece)",
      ]);
      const purchasePrice = Number(purchasePriceVal);
      if (
        purchasePriceVal === undefined ||
        purchasePriceVal === "" ||
        isNaN(purchasePrice) ||
        purchasePrice < 0
      ) {
        errors.push({
          row: rowNum,
          field: "Purchase Price",
          message:
            "Purchase Price must be a valid non-negative number (price per piece).",
        });
        continue;
      }

      const sellingPriceVal = getRowValue(data, [
        "Selling Price",
        "Sale Price",
        "Selling Price (Per Piece)",
      ]);
      const sellingPrice = Number(sellingPriceVal);
      if (
        sellingPriceVal === undefined ||
        sellingPriceVal === "" ||
        isNaN(sellingPrice) ||
        sellingPrice < 0
      ) {
        errors.push({
          row: rowNum,
          field: "Selling Price",
          message:
            "Selling Price must be a valid non-negative number (price per piece).",
        });
        continue;
      }

      const mrpVal = getRowValue(data, ["MRP", "MRP (Per Piece)"]);
      let mrp: number | null = null;
      if (mrpVal !== undefined && mrpVal !== "") {
        const parsedMrp = Number(mrpVal);
        if (isNaN(parsedMrp) || parsedMrp < 0) {
          errors.push({
            row: rowNum,
            field: "MRP",
            message: "MRP must be a valid non-negative number (per piece).",
          });
          continue;
        }
        mrp = parsedMrp;
      }

      // Check duplicate opening-stock batch definitions within file
      const batchCompositeKey = `${matchedMedicine.id}|${batchNo.toLowerCase()}|${purchasePrice.toFixed(2)}|${sellingPrice.toFixed(2)}`;

      if (seenBatchesInFile.has(batchCompositeKey)) {
        const firstSeenRow = seenBatchesInFile.get(batchCompositeKey);
        if (duplicateMode === DuplicateMode.SKIP) {
          skipped.push({
            row: rowNum,
            reason: `Duplicate opening-stock batch row in file (already defined at row ${firstSeenRow})`,
            data: { medicine: matchedMedicine.name, batchNo },
          });
          continue;
        } else {
          errors.push({
            row: rowNum,
            field: "Batch No",
            message: `Duplicate opening-stock batch row in file (matches row ${firstSeenRow}).`,
          });
          continue;
        }
      }

      seenBatchesInFile.set(batchCompositeKey, rowNum);

      const quantityPieces = quantity * unitConfig.piecesPerUnit;

      validOpeningStockRows.push({
        rowNumber: rowNum,
        medicineId: matchedMedicine.id,
        medicineName: matchedMedicine.name,
        batchNo,
        expiryDate: expiryDate.toISOString(),
        unit,
        inputQuantity: quantity,
        piecesPerUnit: unitConfig.piecesPerUnit,
        quantityPieces,
        purchasePrice,
        sellingPrice,
        mrp,
      });
    }
  }

  // Calculate status and summary
  const hasErrors = errors.length > 0;
  const status = hasErrors ? ImportStatus.FAILED : ImportStatus.VALIDATED;

  const validRows =
    importType === ImportType.MEDICINES
      ? validMedicineRows
      : validOpeningStockRows;

  const summary: IImportSummary = {
    totalRows: parsed.totalRows,
    validRows: hasErrors ? 0 : validRows.length,
    skippedRows: skipped.length,
    errorRows: errors.length,
  };

  const jobPayloadData: IImportJobData = {
    errors,
    skippedRows: skipped,
    validRows: hasErrors ? [] : validRows,
    summary,
  };

  // Persist ImportJob record
  const importJob = await prisma.importJob.create({
    data: {
      pharmacyId,
      type: importType,
      fileName,
      status,
      duplicateMode,
      totalRows: parsed.totalRows,
      errorRows: jobPayloadData as any,
      createdById: user.id,
    },
  });

  return {
    jobId: importJob.id,
    type: importJob.type,
    status: importJob.status,
    fileName: importJob.fileName,
    duplicateMode: importJob.duplicateMode,
    summary,
    errors,
    skipped,
  };
};

/**
 * Commits a previously validated import job in an atomic transaction.
 */
const commitImport = async (
  pharmacyId: string,
  user: IImportUserContext,
  jobId: string,
  ip?: string,
  userAgent?: string
) => {
  // Retrieve job ensuring tenant isolation
  const job = await prisma.importJob.findFirst({
    where: {
      id: jobId,
      pharmacyId,
    },
  });

  if (!job) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      `Import job '${jobId}' not found for your pharmacy.`
    );
  }

  if (job.status !== ImportStatus.VALIDATED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Only jobs with status 'VALIDATED' can be committed. Current status is '${job.status}'.`
    );
  }

  const jobPayload = job.errorRows as unknown as IImportJobData | null;
  const validRows = jobPayload?.validRows || [];

  if (validRows.length === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This import job has no valid rows to commit."
    );
  }

  // Cache resolved category IDs to minimize repetitive DB queries during import
  const categoryCache = new Map<string, string>();

  // Interactive transaction timeout: Prisma default is 5000ms which easily expires during batch inserts.
  // Allocate at least 60 seconds, scaling with the number of valid rows (1.5s per row).
  const commitTimeout = Math.max(60000, validRows.length * 1500);

  // Atomic transaction
  const commitResult = await prisma.$transaction(
    async (tx) => {
      // 1. Concurrency control: Atomically update status to prevent simultaneous double-commits
      const lockResult = await tx.importJob.updateMany({
        where: {
          id: jobId,
          pharmacyId,
          status: ImportStatus.VALIDATED,
        },
        data: {
          status: ImportStatus.COMMITTED,
          committedAt: new Date(),
        },
      });

      if (lockResult.count === 0) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Import job has already been committed or is currently being committed by another process."
        );
      }

      if (job.type === ImportType.MEDICINES) {
        const rows = validRows as IValidatedMedicineRow[];

        for (const row of rows) {
          if (row.action === "SKIP") {
            continue;
          }

          let categoryId: string | null = null;

          // Resolve or create Pharmacy-specific Category
          if (row.categoryName) {
            const normCat = row.categoryName.trim();
            const cacheKey = normCat.toLowerCase();

            if (categoryCache.has(cacheKey)) {
              categoryId = categoryCache.get(cacheKey)!;
            } else {
              let existingCategory = await tx.category.findFirst({
                where: {
                  pharmacyId,
                  name: { equals: normCat, mode: "insensitive" },
                },
              });

              if (!existingCategory) {
                existingCategory = await tx.category.create({
                  data: {
                    pharmacyId,
                    name: normCat,
                  },
                });
              }
              categoryId = existingCategory.id;
              categoryCache.set(cacheKey, categoryId);
            }
          }

          if (row.action === "CREATE") {
            await tx.medicine.create({
              data: {
                pharmacyId,
                categoryId,
                name: row.name,
                genericName: row.genericName || null,
                company: row.company || null,
                strength: row.strength || null,
                dosageForm: row.dosageForm || null,
                barcode: row.barcode || null,
                minStockLevel: row.minStockLevel ?? 0,
                isPrescriptionRequired: row.isPrescriptionRequired ?? false,
                status: MedicineStatus.ACTIVE,
                createdById: user.id,
                units: {
                  create: row.units.map((u) => ({
                    unit: u.unit,
                    piecesPerUnit: u.piecesPerUnit,
                  })),
                },
              },
            });
          } else if (row.action === "UPDATE" && row.targetMedicineId) {
            // Update allowed fields of existing medicine
            const updateData: Record<string, unknown> = {};
            if (row.genericName !== undefined)
              updateData.genericName = row.genericName;
            if (row.company !== undefined) updateData.company = row.company;
            if (categoryId) updateData.categoryId = categoryId;
            if (row.barcode !== undefined) updateData.barcode = row.barcode;
            if (row.minStockLevel !== undefined)
              updateData.minStockLevel = row.minStockLevel;
            if (row.isPrescriptionRequired !== undefined)
              updateData.isPrescriptionRequired = row.isPrescriptionRequired;

            await tx.medicine.update({
              where: { id: row.targetMedicineId },
              data: updateData,
            });

            // Upsert unit conversions
            for (const u of row.units) {
              await tx.medicineUnit.upsert({
                where: {
                  medicineId_unit: {
                    medicineId: row.targetMedicineId,
                    unit: u.unit,
                  },
                },
                update: { piecesPerUnit: u.piecesPerUnit },
                create: {
                  medicineId: row.targetMedicineId,
                  unit: u.unit,
                  piecesPerUnit: u.piecesPerUnit,
                },
              });
            }
          }
        }
      } else if (job.type === ImportType.OPENING_STOCK) {
        const rows = validRows as IValidatedOpeningStockRow[];

        for (const row of rows) {
          const expiryDate = new Date(row.expiryDate);

          // Find or create batch with matching prices according to schema unique constraint
          let batch = await tx.medicineBatch.findFirst({
            where: {
              medicineId: row.medicineId,
              batchNo: row.batchNo,
              purchasePrice: row.purchasePrice,
              sellingPrice: row.sellingPrice,
            },
          });

          if (batch) {
            batch = await tx.medicineBatch.update({
              where: { id: batch.id },
              data: {
                receivedQty: { increment: row.quantityPieces },
                availableQty: { increment: row.quantityPieces },
                mrp:
                  row.mrp !== undefined && row.mrp !== null ? row.mrp : batch.mrp,
              },
            });
          } else {
            batch = await tx.medicineBatch.create({
              data: {
                pharmacyId,
                medicineId: row.medicineId,
                batchNo: row.batchNo,
                expiryDate,
                mrp: row.mrp ?? null,
                purchasePrice: row.purchasePrice,
                sellingPrice: row.sellingPrice,
                receivedQty: row.quantityPieces,
                availableQty: row.quantityPieces,
              },
            });
          }

          // Record stock movement OPENING_STOCK
          await tx.stockMovement.create({
            data: {
              pharmacyId,
              medicineId: row.medicineId,
              batchId: batch.id,
              type: StockMovementType.OPENING_STOCK,
              quantityPieces: row.quantityPieces,
              balanceAfter: batch.availableQty,
              refType: "ImportJob",
              refId: jobId,
              note: `Opening stock imported via job ${jobId} (batch ${row.batchNo})`,
              createdById: user.id,
            },
          });
        }
      }

      // Record Audit Log with action IMPORT
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "IMPORT",
          entityType: "ImportJob",
          entityId: jobId,
          newValue: {
            jobId,
            type: job.type,
            duplicateMode: job.duplicateMode,
            totalRows: job.totalRows,
            committedRows: validRows.length,
          } as any,
          reason: `Committed ${job.type} import job (${validRows.length} rows)`,
          ip,
          userAgent,
        },
      });

      return {
        jobId,
        status: ImportStatus.COMMITTED,
        type: job.type,
        committedRows: validRows.length,
        committedAt: new Date(),
      };
    },
    {
      maxWait: 20000,
      timeout: commitTimeout,
    }
  );

  // Invalidate Redis cache
  await invalidateMedicineCache(pharmacyId);

  return commitResult;
};

/**
 * Returns paginated import history for the authenticated pharmacy.
 */
const getImportHistory = async (
  pharmacyId: string,
  query: Record<string, unknown>
) => {
  const normalizedQuery = {
    ...query,
    type:
      query.type === "medicines"
        ? ImportType.MEDICINES
        : query.type === "opening-stock"
          ? ImportType.OPENING_STOCK
          : query.type,
    duplicateMode:
      query.duplicateMode === "skip"
        ? DuplicateMode.SKIP
        : query.duplicateMode === "update"
          ? DuplicateMode.UPDATE
          : query.duplicateMode,
  };

  const importQuery = new QueryBuilder(
    prisma.importJob,
    normalizedQuery as any,
    {
      searchableFields: importSearchableFields,
      filterableFields: importFilterableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate()
    .include({
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    });

  // Enforce tenant isolation strictly
  importQuery.where({ pharmacyId });

  const result = await importQuery.execute();
  const formattedData = result.data.map((job: any) => ({
    id: job.id,
    pharmacyId: job.pharmacyId,
    type: job.type,
    fileName: job.fileName,
    status: job.status,
    duplicateMode: job.duplicateMode,
    totalRows: job.totalRows,
    createdAt: job.createdAt,
    committedAt: job.committedAt,
    createdById: job.createdById,
    createdBy: job.createdBy,
  }));

  return {
    meta: result.meta,
    data: formattedData,
  };
};

/**
 * Returns detailed metadata and row errors for a specific ImportJob.
 */
const getImportJobById = async (pharmacyId: string, jobId: string) => {
  const job = await prisma.importJob.findFirst({
    where: {
      id: jobId,
      pharmacyId,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!job) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      `Import job '${jobId}' not found for your pharmacy.`
    );
  }

  const jobPayload = job.errorRows as unknown as IImportJobData | null;
  const errors = jobPayload?.errors || [];
  const skipped = jobPayload?.skippedRows || [];
  const summary = jobPayload?.summary || {
    totalRows: job.totalRows,
    validRows: job.status === ImportStatus.COMMITTED ? job.totalRows : 0,
    skippedRows: skipped.length,
    errorRows: errors.length,
  };

  return {
    id: job.id,
    pharmacyId: job.pharmacyId,
    type: job.type,
    fileName: job.fileName,
    status: job.status,
    duplicateMode: job.duplicateMode,
    totalRows: job.totalRows,
    summary,
    errors,
    skipped,
    createdAt: job.createdAt,
    committedAt: job.committedAt,
    createdBy: job.createdBy,
  };
};

export const ExcelCsvImportService = {
  getTemplate,
  validateImport,
  commitImport,
  getImportHistory,
  getImportJobById,
};
