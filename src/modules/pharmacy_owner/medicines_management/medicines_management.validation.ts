import { z } from "zod";
import { MedicineStatus, UnitName } from "@prisma/client";

// Shared unit conversion item schema
const unitItemSchema = z.object({
  unit: z.enum([UnitName.BOX, UnitName.STRIP, UnitName.PIECE], {
    message: "Unit must be BOX, STRIP, or PIECE",
  }),
  piecesPerUnit: z
    .number({
      message: "piecesPerUnit must be a number",
    })
    .int("piecesPerUnit must be an integer")
    .min(1, "piecesPerUnit must be at least 1"),
});

// POST /medicines
const createMedicineSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, "Medicine name is required"),
      genericName: z.string().trim().nullable().optional(),
      company: z.string().trim().nullable().optional(),
      categoryId: z.string().trim().nullable().optional(),
      strength: z.string().trim().nullable().optional(),
      dosageForm: z.string().trim().nullable().optional(),
      barcode: z.string().trim().nullable().optional(),
      minStockLevel: z
        .number()
        .int("minStockLevel must be an integer")
        .min(0, "minStockLevel cannot be negative")
        .optional(),
      isPrescriptionRequired: z.boolean().optional(),
      units: z.array(unitItemSchema).optional(),
    })
    .strict(),
});

// POST /medicines/quick-add
const quickAddMedicineSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, "Medicine name is required"),
      genericName: z.string().trim().nullable().optional(),
      company: z.string().trim().nullable().optional(),
      categoryId: z.string().trim().nullable().optional(),
      strength: z.string().trim().nullable().optional(),
      dosageForm: z.string().trim().nullable().optional(),
      barcode: z.string().trim().nullable().optional(),
      minStockLevel: z
        .number()
        .int("minStockLevel must be an integer")
        .min(0, "minStockLevel cannot be negative")
        .optional(),
      isPrescriptionRequired: z.boolean().optional(),
      units: z.array(unitItemSchema).optional(),
      firstBatch: z
        .object({
          batchNo: z.string().trim().min(1, "Batch number is required"),
          expiry: z
            .string()
            .trim()
            .regex(
              /^(0[1-9]|1[0-2])\/\d{4}$/,
              "Expiry must be in MM/YYYY format"
            ),
          mrp: z
            .number()
            .min(0, "MRP cannot be negative")
            .nullable()
            .optional(),
          purchasePrice: z
            .number({
              message: "Purchase price is required",
            })
            .min(0, "Purchase price cannot be negative"),
          sellingPrice: z
            .number({
              message: "Selling price is required",
            })
            .min(0, "Selling price cannot be negative"),
          quantity: z
            .number({
              message: "Quantity is required",
            })
            .int("Quantity must be an integer")
            .min(1, "Quantity must be at least 1"),
          unit: z.enum([UnitName.BOX, UnitName.STRIP, UnitName.PIECE], {
            message: "Purchase unit must be BOX, STRIP, or PIECE",
          }),
        })
        .strict()
        .optional(),
    })
    .strict(),
});

// PATCH /medicines/:id
const updateMedicineSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1, "Medicine ID is required"),
  }),
  body: z
    .object({
      name: z.string().trim().min(1, "Medicine name cannot be empty").optional(),
      genericName: z.string().trim().nullable().optional(),
      company: z.string().trim().nullable().optional(),
      categoryId: z.string().trim().nullable().optional(),
      strength: z.string().trim().nullable().optional(),
      dosageForm: z.string().trim().nullable().optional(),
      barcode: z.string().trim().nullable().optional(),
      minStockLevel: z
        .number()
        .int("minStockLevel must be an integer")
        .min(0, "minStockLevel cannot be negative")
        .optional(),
      isPrescriptionRequired: z.boolean().optional(),
    })
    .strict(),
});

// PATCH /medicines/:id/status
const changeMedicineStatusSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1, "Medicine ID is required"),
  }),
  body: z
    .object({
      status: z.enum([MedicineStatus.ACTIVE, MedicineStatus.INACTIVE], {
        message: "Status must be either ACTIVE or INACTIVE",
      }),
    })
    .strict(),
});

// PUT /medicines/:id/units
const replaceMedicineUnitsSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1, "Medicine ID is required"),
  }),
  body: z
    .object({
      units: z
        .array(unitItemSchema)
        .min(1, "At least one unit must be provided"),
    })
    .strict(),
});

// GET /medicines/:id/batches
const getMedicineBatchesSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1, "Medicine ID is required"),
  }),
  query: z
    .object({
      page: z.string().regex(/^\d+$/).optional(),
      limit: z.string().regex(/^\d+$/).optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      search: z.string().optional(),
      searchTerm: z.string().optional(),
    })
    .passthrough()
    .optional(),
});

// GET /medicines
const getMedicinesQuerySchema = z.object({
  query: z
    .object({
      page: z
        .string()
        .regex(/^\d+$/, "Page must be a positive integer")
        .optional(),
      limit: z
        .string()
        .regex(/^\d+$/, "Limit must be a positive integer")
        .optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      search: z.string().optional(),
      searchTerm: z.string().optional(),
      categoryId: z.string().optional(),
      status: z.enum([MedicineStatus.ACTIVE, MedicineStatus.INACTIVE]).optional(),
      lowStock: z.enum(["true", "false"]).optional(),
      expired: z.enum(["true", "false"]).optional(),
      expiringDays: z
        .enum(["30", "60", "90"] as const, {
          message: "expiringDays must be one of 30, 60, or 90",
        })
        .optional(),
    })
    .passthrough()
    .optional(),
});

// GET /medicines/lookup?barcode=...
const barcodeLookupQuerySchema = z.object({
  query: z.object({
    barcode: z.string().trim().min(1, "Barcode is required"),
  }),
});

// GET /medicines/search?q=...
const searchMedicinesQuerySchema = z.object({
  query: z.object({
    q: z.string().trim().min(1, "Search query 'q' is required"),
  }),
});

// GET /medicines/:id
const getMedicineByIdSchema = z.object({
  params: z.object({
    id: z.string().trim().min(1, "Medicine ID is required"),
  }),
});

export const MedicinesManagementValidation = {
  createMedicineSchema,
  quickAddMedicineSchema,
  updateMedicineSchema,
  changeMedicineStatusSchema,
  replaceMedicineUnitsSchema,
  getMedicineBatchesSchema,
  getMedicinesQuerySchema,
  barcodeLookupQuerySchema,
  searchMedicinesQuerySchema,
  getMedicineByIdSchema,
};
