export const SALES_RETURN_ERROR_CODES = {
  RETURN_QTY_EXCEEDED: "RETURN_QTY_EXCEEDED",
  SALE_CANCELLED: "SALE_CANCELLED",
  SALE_NOT_FOUND: "SALE_NOT_FOUND",
  SALE_ITEM_NOT_FOUND: "SALE_ITEM_NOT_FOUND",
  DUPLICATE_ITEM_ENTRY: "DUPLICATE_ITEM_ENTRY",
  INVALID_UNIT: "INVALID_UNIT",
  FORBIDDEN_FILTER_PARAM: "FORBIDDEN_FILTER_PARAM",
} as const;

export const salesReturnSearchableFields = ["returnNo", "reason"];

export const salesReturnFilterableFields = [
  "saleId",
  "createdById",
  "date",
  "from",
  "to",
];
