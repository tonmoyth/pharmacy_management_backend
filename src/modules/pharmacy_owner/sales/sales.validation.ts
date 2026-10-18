import { z } from "zod";
import { DiscountType, PayMethod, SaleStatus, UnitName } from "@prisma/client";

const saleItemInputZodSchema = z.object({
  medicineId: z
    .string()
    .trim()
    .min(1, "Medicine ID is required"),
  unit: z.nativeEnum(UnitName),
  quantity: z
    .number()
    .int("Quantity must be an integer")
    .positive("Quantity must be greater than 0"),
  batchId: z
    .string()
    .trim()
    .min(1, "Batch ID cannot be empty")
    .optional(),
});

const discountZodSchema = z
  .object({
    type: z.nativeEnum(DiscountType).default(DiscountType.NONE),
    value: z
      .number()
      .min(0, "Discount value cannot be negative"),
  })
  .refine(
    (data) => {
      if (data.type === DiscountType.PERCENT && data.value > 100) {
        return false;
      }
      return true;
    },
    {
      message: "Percentage discount cannot exceed 100%",
      path: ["value"],
    }
  );

const previewSaleZodSchema = z.object({
  body: z.object({
    items: z
      .array(saleItemInputZodSchema)
      .min(1, "At least one item is required for preview"),
    discount: discountZodSchema.optional(),
    customerId: z
      .string()
      .trim()
      .min(1, "Customer ID cannot be empty")
      .optional(),
  }),
});

const confirmSaleZodSchema = z.object({
  body: z.object({
    items: z
      .array(saleItemInputZodSchema)
      .min(1, "At least one item is required to complete a sale"),
    discount: discountZodSchema.optional(),
    paidAmount: z
      .number()
      .min(0, "Paid amount cannot be negative"),
    paymentMethod: z
      .nativeEnum(PayMethod)
      .default(PayMethod.CASH),
    customerId: z
      .string()
      .trim()
      .min(1, "Customer ID cannot be empty")
      .nullable()
      .optional(),
    note: z
      .string()
      .trim()
      .max(500, "Note cannot exceed 500 characters")
      .nullable()
      .optional(),
  }),
});

const cancelSaleZodSchema = z.object({
  body: z.object({
    reason: z
      .string()
      .trim()
      .min(1, "Cancellation reason cannot be empty")
      .max(500, "Cancellation reason cannot exceed 500 characters"),
  }),
});

const getSalesQueryZodSchema = z.object({
  query: z
    .object({
      page: z.string().optional(),
      limit: z.string().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      invoiceNo: z.string().optional(),
      medicineId: z.string().optional(),
      customerId: z.string().optional(),
      paymentStatus: z.enum(["paid", "due"]).optional(),
      status: z.nativeEnum(SaleStatus).optional(),
      createdById: z.string().optional(),
    })
    .optional(),
});

const invoicePdfQueryZodSchema = z.object({
  query: z
    .object({
      size: z.enum(["a4", "thermal80"]).optional(),
    })
    .optional(),
});

export const SalesValidation = {
  saleItemInputZodSchema,
  discountZodSchema,
  previewSaleZodSchema,
  confirmSaleZodSchema,
  cancelSaleZodSchema,
  getSalesQueryZodSchema,
  invoicePdfQueryZodSchema,
};
