export const purchaseSearchableFields = ["invoiceNo", "note"];

export const purchaseFilterableFields = ["supplierId", "status", "invoiceNo"];

export const PRICE_WARNING_CODES = {
  SELLING_PRICE_BELOW_PURCHASE_PRICE: "SELLING_PRICE_BELOW_PURCHASE_PRICE",
  SELLING_PRICE_ABOVE_MRP: "SELLING_PRICE_ABOVE_MRP",
} as const;
