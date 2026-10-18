export const SALES_ERROR_CODES = {
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  EXPIRED_BATCH: "EXPIRED_BATCH",
  DISCOUNT_LIMIT_EXCEEDED: "DISCOUNT_LIMIT_EXCEEDED",
  CUSTOMER_REQUIRED_FOR_DUE: "CUSTOMER_REQUIRED_FOR_DUE",
  SALE_ALREADY_CANCELLED: "SALE_ALREADY_CANCELLED",
  SALE_HAS_RETURNS: "SALE_HAS_RETURNS",
} as const;

export const SALES_WARNING_CODES = {
  PRESCRIPTION_REQUIRED: "PRESCRIPTION_REQUIRED",
  CREDIT_LIMIT_EXCEEDED: "CREDIT_LIMIT_EXCEEDED",
} as const;

export const INVOICE_PDF_SIZES = {
  A4: "a4",
  THERMAL80: "thermal80",
} as const;

export type InvoicePdfSize =
  (typeof INVOICE_PDF_SIZES)[keyof typeof INVOICE_PDF_SIZES];

export const salesSearchableFields = ["invoiceNo", "note"];

export const salesFilterableFields = [
  "status",
  "paymentMethod",
  "customerId",
  "createdById",
];
