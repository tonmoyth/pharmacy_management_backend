import { z } from "zod";
import { PurchaseReturnReason, UnitName } from "@prisma/client";

const returnItemSchema = z.object({
  purchaseItemId: z
    .string()
    .trim()
    .min(1, "Purchase item ID is required"),
  quantity: z
    .number()
    .int("Quantity must be an integer")
    .positive("Quantity must be greater than 0"),
  unit: z.nativeEnum(UnitName),
});

const createPurchaseReturnZodSchema = z.object({
  body: z
    .object({
      purchaseId: z
        .string()
        .trim()
        .min(1, "Purchase ID is required"),
      reason: z.nativeEnum(PurchaseReturnReason),
      note: z
        .string()
        .trim()
        .max(500, "Note cannot exceed 500 characters")
        .nullable()
        .optional(),
      items: z
        .array(returnItemSchema)
        .min(1, "Purchase return must contain at least one item"),
    })
    .strict(),
});

const getPurchaseReturnsQueryZodSchema = z.object({
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
      purchaseId: z.string().optional(),
      reason: z.nativeEnum(PurchaseReturnReason).optional(),
    })
    .optional(),
});

export const PurchaseReturnValidation = {
  returnItemSchema,
  createPurchaseReturnZodSchema,
  getPurchaseReturnsQueryZodSchema,
};
