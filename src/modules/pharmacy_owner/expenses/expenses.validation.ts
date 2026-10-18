import { z } from "zod";
import { ExpenseCategory } from "@prisma/client";

const isValidDate = (val: string) => !isNaN(Date.parse(val));

const createExpenseZodSchema = z.object({
  body: z.object({
    category: z.nativeEnum(ExpenseCategory),
    amount: z
      .union([z.string(), z.number()])
      .transform((val) => Number(val))
      .refine(
        (val) => !isNaN(val) && val > 0,
        "Expense amount must be a positive number"
      ),
    expenseDate: z
      .string()
      .trim()
      .min(1, "Expense date is required")
      .refine(isValidDate, "Invalid expense date format"),
    note: z
      .string()
      .trim()
      .max(500, "Expense note cannot exceed 500 characters")
      .nullable()
      .optional()
      .transform((val) => (val === "" ? null : val)),
  }),
});

const updateExpenseZodSchema = z.object({
  body: z.object({
    category: z.nativeEnum(ExpenseCategory).optional(),
    amount: z
      .union([z.string(), z.number()])
      .optional()
      .transform((val) => (val !== undefined ? Number(val) : undefined))
      .refine(
        (val) => val === undefined || (!isNaN(val) && val > 0),
        "Expense amount must be a positive number"
      ),
    expenseDate: z
      .string()
      .trim()
      .optional()
      .refine(
        (val) => !val || isValidDate(val),
        "Invalid expense date format"
      ),
    note: z
      .string()
      .trim()
      .max(500, "Expense note cannot exceed 500 characters")
      .nullable()
      .optional()
      .transform((val) => (val === "" ? null : val)),
  }),
});

const getExpensesQueryZodSchema = z.object({
  query: z
    .object({
      category: z.nativeEnum(ExpenseCategory).optional(),
      from: z
        .string()
        .optional()
        .refine((val) => !val || isValidDate(val), "Invalid 'from' date format"),
      to: z
        .string()
        .optional()
        .refine((val) => !val || isValidDate(val), "Invalid 'to' date format"),
      search: z.string().optional(),
      searchTerm: z.string().optional(),
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
    .optional()
    .refine(
      (q) => {
        if (q?.from && q?.to) {
          return new Date(q.from) <= new Date(q.to);
        }
        return true;
      },
      {
        message: "'from' date cannot be later than 'to' date",
        path: ["from"],
      }
    ),
});

const getExpensesSummaryQueryZodSchema = z.object({
  query: z
    .object({
      from: z
        .string()
        .optional()
        .refine((val) => !val || isValidDate(val), "Invalid 'from' date format"),
      to: z
        .string()
        .optional()
        .refine((val) => !val || isValidDate(val), "Invalid 'to' date format"),
    })
    .optional()
    .refine(
      (q) => {
        if (q?.from && q?.to) {
          return new Date(q.from) <= new Date(q.to);
        }
        return true;
      },
      {
        message: "'from' date cannot be later than 'to' date",
        path: ["from"],
      }
    ),
});

export const ExpenseValidation = {
  createExpenseZodSchema,
  updateExpenseZodSchema,
  getExpensesQueryZodSchema,
  getExpensesSummaryQueryZodSchema,
};
