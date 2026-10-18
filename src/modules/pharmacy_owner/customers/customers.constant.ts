export const CUSTOMER_ERROR_CODES = {
  CUSTOMER_NOT_FOUND: "CUSTOMER_NOT_FOUND",
  PHONE_ALREADY_EXISTS: "PHONE_ALREADY_EXISTS",
  CUSTOMER_INACTIVE: "CUSTOMER_INACTIVE",
  PAYMENT_EXCEEDS_DUE: "PAYMENT_EXCEEDS_DUE",
  INVALID_PAYMENT_AMOUNT: "INVALID_PAYMENT_AMOUNT",
  CUSTOMER_CANNOT_BE_DELETED: "CUSTOMER_CANNOT_BE_DELETED",
  CREDIT_LIMIT_EXCEEDED: "CREDIT_LIMIT_EXCEEDED",
} as const;

export const customerSearchableFields = ["name", "phone", "address"];
export const customerFilterableFields = ["isActive", "phone"];

export const customerSalesSearchableFields = ["invoiceNo"];
export const customerSalesFilterableFields = ["status", "paymentMethod"];

export const customerPaymentFilterableFields = ["method"];
