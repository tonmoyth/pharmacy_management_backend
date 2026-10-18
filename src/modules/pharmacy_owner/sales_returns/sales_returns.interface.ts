import { Role, UnitName } from "@prisma/client";

export interface ICreateSalesReturnItem {
  saleItemId: string;
  quantity: number;
  unit: UnitName;
}

export interface ICreateSalesReturnPayload {
  saleId: string;
  reason: string;
  items: ICreateSalesReturnItem[];
}

export interface ISalesReturnUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface IGetSalesReturnsQuery {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  date?: string;
  from?: string;
  to?: string;
  saleId?: string;
  createdById?: string;
  searchTerm?: string;
}

export interface ISalesReturnItemResponse {
  id: string;
  saleItemId: string;
  medicineId: string;
  medicineName: string;
  genericName?: string | null;
  batchId: string;
  batchNo: string;
  expiryDate: Date;
  quantityPieces: number;
  unitPricePerPiece: number;
  amount: number;
  discountShare: number;
  refundAmount: number;
  originalSoldPieces: number;
  totalReturnedPiecesAfterThis: number;
  remainingReturnablePieces: number;
}

export interface ISalesReturnResponse {
  id: string;
  pharmacyId: string;
  returnNo: string;
  saleId: string;
  invoiceNo: string;
  reason: string;
  itemsAmount: number;
  discountShare: number;
  refundAmount: number;
  dueReduced: number;
  cashRefunded: number;
  createdAt: Date;
  createdBy: {
    id: string;
    name: string;
    email: string;
    role: Role;
  };
  customer?: {
    id: string;
    name: string;
    phone?: string | null;
    dueBalance: number;
  } | null;
  items: ISalesReturnItemResponse[];
}
