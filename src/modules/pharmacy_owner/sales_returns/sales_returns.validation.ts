import { z } from "zod";
import { UnitName } from "@prisma/client";

const salesReturnItemInputZodSchema = z.object({
  saleItemId: z
    .string()
    .trim()
    .min(1, "Sale item ID is required"),
  quantity: z
    .number()
    .int("Quantity must be an integer")
    .positive("Quantity must be greater than 0"),
  unit: z.nativeEnum(UnitName),
});

const createSalesReturnZodSchema = z.object({
  body: z.object({
    saleId: z
      .string()
      .trim()
      .min(1, "Sale ID is required"),
    reason: z
      .string()
      .trim()
      .min(1, "Return reason cannot be empty")
      .max(500, "Return reason cannot exceed 500 characters"),
    items: z
      .array(salesReturnItemInputZodSchema)
      .min(1, "At least one item is required for return"),
  }),
});

const getSalesReturnsQueryZodSchema = z.object({
  query: z
    .object({
      page: z.string().optional(),
      limit: z.string().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      date: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      saleId: z.string().optional(),
      createdById: z.string().optional(),
      searchTerm: z.string().optional(),
    })
    .optional(),
});

export const SalesReturnValidation = {
  createSalesReturnZodSchema,
  getSalesReturnsQueryZodSchema,
};
