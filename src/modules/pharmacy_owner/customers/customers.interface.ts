import { PayMethod, Role, SaleStatus } from "@prisma/client";

export interface ICustomerUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface ICreateCustomerPayload {
  name: string;
  phone?: string | null;
  address?: string | null;
  creditLimit?: number | null;
}

export interface IUpdateCustomerPayload {
  name?: string;
  phone?: string | null;
  address?: string | null;
  creditLimit?: number | null;
  isActive?: boolean;
}

export interface ICreateDuePaymentPayload {
  amount: number;
  method: PayMethod;
  paidAt?: string | Date;
  note?: string | null;
}

export interface ICustomerFinancialSummary {
  totalPurchase: number;
  totalPaid: number;
  dueBalance: number;
  creditLimit: number | null;
}

export interface ICustomerResponse extends ICustomerFinancialSummary {
  id: string;
  pharmacyId: string;
  name: string;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICustomerLedgerEntry {
  id: string;
  type: "SALE_DUE" | "DUE_PAYMENT" | "SALE_RETURN_DUE_REDUCTION";
  referenceNo: string;
  date: Date;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface IDuePaymentAllocationResult {
  saleId: string;
  invoiceNo: string;
  amount: number;
  remainingDue: number;
}

export interface IDuePaymentResult {
  id: string;
  pharmacyId: string;
  customerId: string;
  customerName: string;
  amount: number;
  method: PayMethod;
  paidAt: Date;
  note: string | null;
  previousDueBalance: number;
  newDueBalance: number;
  allocations: IDuePaymentAllocationResult[];
  createdBy: {
    id: string;
    name: string;
    role: Role;
  };
  createdAt: Date;
}
