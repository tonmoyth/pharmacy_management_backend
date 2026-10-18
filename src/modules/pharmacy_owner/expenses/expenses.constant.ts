import { ExpenseCategory } from "@prisma/client";

export const EXPENSE_ERROR_CODES = {
  EXPENSE_NOT_FOUND: "EXPENSE_NOT_FOUND",
  INVALID_CATEGORY: "INVALID_CATEGORY",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  INVALID_DATE_RANGE: "INVALID_DATE_RANGE",
  INVALID_FILE_TYPE: "INVALID_FILE_TYPE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  ATTACHMENT_UPLOAD_FAILED: "ATTACHMENT_UPLOAD_FAILED",
} as const;

export const ALLOWED_EXPENSE_CATEGORIES = Object.values(ExpenseCategory);

export const ALLOWED_EXPENSE_FILE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
  "application/pdf",
];

export const MAX_EXPENSE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const expenseSearchableFields = ["note"];
export const expenseFilterableFields = ["category"];
