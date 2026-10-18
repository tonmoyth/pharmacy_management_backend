import {
  DiscountType,
  PayMethod,
  Role,
  SaleStatus,
  UnitName,
} from "@prisma/client";
import { InvoicePdfSize } from "./sales.constant";

export interface ISaleUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface ISaleItemInput {
  medicineId: string;
  unit: UnitName;
  quantity: number;
  batchId?: string;
}

export interface IDiscountInput {
  type: DiscountType;
  value: number;
}

export interface IPreviewSalePayload {
  items: ISaleItemInput[];
  discount?: IDiscountInput;
  customerId?: string;
}

export interface IConfirmSalePayload {
  items: ISaleItemInput[];
  discount?: IDiscountInput;
  paidAmount: number;
  paymentMethod?: PayMethod;
  customerId?: string | null;
  note?: string | null;
}

export interface ICancelSalePayload {
  reason: string;
}

export interface ISaleWarning {
  code: string;
  message: string;
  medicineId?: string;
  customerId?: string;
}

export interface IAllocatedBatchLine {
  medicineId: string;
  medicineName: string;
  genericName?: string | null;
  batchId: string;
  batchNo: string;
  expiryDate: Date | string;
  enteredUnit: UnitName;
  enteredQty: number;
  quantityPieces: number;
  unitPricePerPiece: number;
  costPricePerPiece?: number;
  lineSubtotal: number;
}

export interface IPreviewSaleResult {
  allocations: IAllocatedBatchLine[];
  subtotal: number;
  discount: {
    type: DiscountType;
    value: number;
    discountAmount: number;
  };
  totalAmount: number;
  warnings: ISaleWarning[];
}

export interface IConfirmSaleResult {
  sale: Record<string, unknown>;
  items: IAllocatedBatchLine[];
  warnings: ISaleWarning[];
}

export interface IGetSalesQuery {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  from?: string;
  to?: string;
  invoiceNo?: string;
  medicineId?: string;
  customerId?: string;
  paymentStatus?: "paid" | "due";
  status?: SaleStatus;
  createdById?: string;
}

export interface IInvoiceItemDetail {
  saleItemId: string;
  medicineId: string;
  medicineName: string;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  batchId: string;
  batchNo: string;
  expiryDate: Date | string;
  enteredUnit: UnitName;
  enteredQty: number;
  quantityPieces: number;
  unitPricePerPiece: number;
  costPricePerPiece?: number;
  lineSubtotal: number;
  discountShare: number;
  lineTotal: number;
  returnedQtyPieces: number;
  returnableQuantity: number;
}

export interface IInvoiceJSONResult {
  pharmacy: {
    id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    city: string;
    area: string;
    invoiceHeader?: string | null;
    invoiceFooter?: string | null;
  };
  sale: {
    id: string;
    invoiceNo: string;
    invoiceSeq: number;
    soldAt: string;
    status: SaleStatus;
    paymentMethod: PayMethod;
    subtotal: number;
    discountType: DiscountType;
    discountValue: number;
    discountAmount: number;
    totalAmount: number;
    paidAmount: number;
    dueAmount: number;
    note?: string | null;
    cancelReason?: string | null;
    cancelledAt?: string | null;
    cancelRefundAmount?: number | null;
  };
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
    address?: string | null;
  } | null;
  createdBy: {
    id: string;
    name: string;
    role: Role;
  };
  cancelledBy?: {
    id: string;
    name: string;
    role: Role;
  } | null;
  items: IInvoiceItemDetail[];
}
