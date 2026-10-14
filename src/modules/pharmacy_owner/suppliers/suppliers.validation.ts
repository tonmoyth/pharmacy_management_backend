import { z } from "zod";
import { PayMethod } from "@prisma/client";

const createSupplierZodSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, "Supplier name is required")
        .max(255, "Supplier name cannot exceed 255 characters"),
      phone: z
        .string()
        .trim()
        .max(50, "Phone number cannot exceed 50 characters")
        .nullable()
        .optional(),
      address: z
        .string()
        .trim()
        .max(500, "Address cannot exceed 500 characters")
        .nullable()
        .optional(),
      company: z
        .string()
        .trim()
        .max(255, "Company name cannot exceed 255 characters")
        .nullable()
        .optional(),
    })
    .strict(),
});

const updateSupplierZodSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, "Supplier name cannot be empty")
        .max(255, "Supplier name cannot exceed 255 characters")
        .optional(),
      phone: z
        .string()
        .trim()
        .max(50, "Phone number cannot exceed 50 characters")
        .nullable()
        .optional(),
      address: z
        .string()
        .trim()
        .max(500, "Address cannot exceed 500 characters")
        .nullable()
        .optional(),
      company: z
        .string()
        .trim()
        .max(255, "Company name cannot exceed 255 characters")
        .nullable()
        .optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
});

const recordSupplierPaymentZodSchema = z.object({
  body: z
    .object({
      amount: z.preprocess(
        (val) => (typeof val === "string" ? parseFloat(val) : val),
        z.number().positive("Payment amount must be greater than 0")
      ),
      method: z.nativeEnum(PayMethod),
      paidAt: z
        .string()
        .datetime({ message: "Invalid date format for paidAt" })
        .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format"))
        .optional(),
      note: z
        .string()
        .trim()
        .max(500, "Note cannot exceed 500 characters")
        .nullable()
        .optional(),
      purchaseId: z.string().cuid().or(z.string().min(1)).nullable().optional(),
    })
    .strict(),
});

export const SupplierValidation = {
  createSupplierZodSchema,
  updateSupplierZodSchema,
  recordSupplierPaymentZodSchema,
};
