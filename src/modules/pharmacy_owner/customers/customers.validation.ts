import { z } from "zod";
import { PayMethod } from "@prisma/client";

const createCustomerZodSchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1, "Customer name cannot be empty")
      .max(100, "Customer name cannot exceed 100 characters"),
    phone: z
      .string()
      .trim()
      .max(20, "Phone number cannot exceed 20 characters")
      .nullable()
      .optional()
      .transform((val) => (val === "" ? null : val)),
    address: z
      .string()
      .trim()
      .max(255, "Address cannot exceed 255 characters")
      .nullable()
      .optional()
      .transform((val) => (val === "" ? null : val)),
    creditLimit: z
      .number()
      .min(0, "Credit limit must be non-negative")
      .nullable()
      .optional(),
  }),
});

const updateCustomerZodSchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(1, "Customer name cannot be empty")
      .max(100, "Customer name cannot exceed 100 characters")
      .optional(),
    phone: z
      .string()
      .trim()
      .max(20, "Phone number cannot exceed 20 characters")
      .nullable()
      .optional()
      .transform((val) => (val === "" ? null : val)),
    address: z
      .string()
      .trim()
      .max(255, "Address cannot exceed 255 characters")
      .nullable()
      .optional()
      .transform((val) => (val === "" ? null : val)),
    creditLimit: z
      .number()
      .min(0, "Credit limit must be non-negative")
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  }),
});

const getCustomersQueryZodSchema = z.object({
  query: z
    .object({
      search: z.string().optional(),
      searchTerm: z.string().optional(),
      hasDue: z
        .union([z.string(), z.boolean()])
        .optional(),
      isActive: z
        .union([z.string(), z.boolean()])
        .optional(),
      page: z
        .union([z.string(), z.number()])
        .optional()
        .transform((val) => (val !== undefined ? Number(val) : 1)),
      limit: z
        .union([z.string(), z.number()])
        .optional()
        .transform((val) => (val !== undefined ? Number(val) : 10)),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
    })
    .optional(),
});

const createDuePaymentZodSchema = z.object({
  body: z.object({
    amount: z
      .number()
      .positive("Payment amount must be strictly greater than 0")
      .finite("Payment amount must be a finite number"),
    method: z.nativeEnum(PayMethod),
    paidAt: z
      .string()
      .optional()
      .refine(
        (val) => !val || !isNaN(Date.parse(val)),
        "Invalid paidAt date format"
      ),
    note: z
      .string()
      .trim()
      .max(500, "Note cannot exceed 500 characters")
      .nullable()
      .optional()
      .transform((val) => (val === "" ? null : val)),
  }),
});

const getCustomerSalesQueryZodSchema = z.object({
  query: z
    .object({
      search: z.string().optional(),
      searchTerm: z.string().optional(),
      status: z.string().optional(),
      page: z
        .union([z.string(), z.number()])
        .optional()
        .transform((val) => (val !== undefined ? Number(val) : 1)),
      limit: z
        .union([z.string(), z.number()])
        .optional()
        .transform((val) => (val !== undefined ? Number(val) : 10)),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
    })
    .optional(),
});

const getDuePaymentsQueryZodSchema = z.object({
  query: z
    .object({
      page: z
        .union([z.string(), z.number()])
        .optional()
        .transform((val) => (val !== undefined ? Number(val) : 1)),
      limit: z
        .union([z.string(), z.number()])
        .optional()
        .transform((val) => (val !== undefined ? Number(val) : 10)),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
    })
    .optional(),
});

export const CustomerValidation = {
  createCustomerZodSchema,
  updateCustomerZodSchema,
  getCustomersQueryZodSchema,
  createDuePaymentZodSchema,
  getCustomerSalesQueryZodSchema,
  getDuePaymentsQueryZodSchema,
};
