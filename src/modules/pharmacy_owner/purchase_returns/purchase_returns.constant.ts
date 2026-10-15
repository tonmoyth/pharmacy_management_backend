export const purchaseReturnSearchableFields = ["returnNo", "note"];

export const purchaseReturnFilterableFields = [
  "supplierId",
  "purchaseId",
  "reason",
];

export const PURCHASE_RETURN_ERROR_CODES = {
  RETURN_QTY_EXCEEDED: "RETURN_QTY_EXCEEDED",
} as const;
