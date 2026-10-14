import { z } from "zod";
import { PayMethod, PurchaseStatus, UnitName } from "@prisma/client";

const purchaseItemSchema = z.object({
  medicineId: z
    .string()
    .trim()
    .min(1, "Medicine ID is required"),
  unit: z.nativeEnum(UnitName),
  quantity: z
    .number()
    .int("Quantity must be an integer")
    .positive("Quantity must be greater than 0"),
  batchNo: z
    .string()
    .trim()
    .min(1, "Batch number cannot be empty")
    .max(100, "Batch number cannot exceed 100 characters"),
  expiry: z
    .string()
    .trim()
    .regex(
      /^(0[1-9]|1[0-2])\/\d{4}$/,
      "Expiry date must be in strict MM/YYYY format (e.g. 12/2027)"
    ),
  mrp: z
    .number()
    .positive("MRP must be greater than 0")
    .nullable()
    .optional(),
  purchasePrice: z
    .number()
    .positive("Purchase price must be greater than 0"),
  sellingPrice: z
    .number()
    .positive("Selling price must be greater than 0"),
});

const createPurchaseZodSchema = z.object({
  body: z
    .object({
      supplierId: z
        .string()
        .trim()
        .min(1, "Supplier ID is required"),
      invoiceNo: z
        .string()
        .trim()
        .min(1, "Invoice number cannot be empty")
        .max(100, "Invoice number cannot exceed 100 characters"),
      purchaseDate: z
        .string()
        .trim()
        .min(1, "Purchase date is required"),
      paidAmount: z
        .number()
        .min(0, "Paid amount cannot be negative")
        .default(0)
        .optional(),
      paymentMethod: z
        .nativeEnum(PayMethod)
        .default(PayMethod.CASH)
        .optional(),
      note: z
        .string()
        .trim()
        .max(500, "Note cannot exceed 500 characters")
        .nullable()
        .optional(),
      items: z
        .array(purchaseItemSchema)
        .min(1, "Purchase must contain at least one item"),
    })
    .strict(),
});

const updatePurchaseZodSchema = z.object({
  body: z
    .object({
      invoiceNo: z
        .string()
        .trim()
        .min(1, "Invoice number cannot be empty")
        .max(100, "Invoice number cannot exceed 100 characters")
        .optional(),
      purchaseDate: z.string().trim().min(1).optional(),
      note: z
        .string()
        .trim()
        .max(500, "Note cannot exceed 500 characters")
        .nullable()
        .optional(),
      items: z
        .array(purchaseItemSchema)
        .min(1, "Purchase must contain at least one item")
        .optional(),
    })
    .strict(),
});

const cancelPurchaseZodSchema = z.object({
  body: z
    .object({
      reason: z
        .string()
        .trim()
        .min(1, "Cancellation reason is required")
        .max(500, "Cancellation reason cannot exceed 500 characters"),
    })
    .strict(),
});

const getPurchasesQueryZodSchema = z.object({
  query: z
    .object({
      page: z.string().optional(),
      limit: z.string().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      searchTerm: z.string().optional(),
      search: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      supplierId: z.string().optional(),
      medicineId: z.string().optional(),
      status: z.nativeEnum(PurchaseStatus).optional(),
      invoiceNo: z.string().optional(),
    })
    .optional(),
});

export const PurchaseValidation = {
  purchaseItemSchema,
  createPurchaseZodSchema,
  updatePurchaseZodSchema,
  cancelPurchaseZodSchema,
  getPurchasesQueryZodSchema,
};
