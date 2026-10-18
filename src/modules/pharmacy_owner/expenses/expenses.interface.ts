import { ExpenseCategory, Role } from "@prisma/client";

export interface IExpenseUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface ICreateExpensePayload {
  category: ExpenseCategory;
  amount: number;
  expenseDate: string | Date;
  note?: string | null;
}

export interface IUpdateExpensePayload {
  category?: ExpenseCategory;
  amount?: number;
  expenseDate?: string | Date;
  note?: string | null;
}

export interface IExpenseFilterQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  category?: ExpenseCategory;
  from?: string;
  to?: string;
  search?: string;
  searchTerm?: string;
}

export interface IExpenseSummaryQuery {
  from?: string;
  to?: string;
}

export interface ICategorySummaryItem {
  category: ExpenseCategory;
  totalAmount: number;
  count: number;
}

export interface IExpenseSummaryResponse {
  from?: string;
  to?: string;
  totalAmount: number;
  totalCount: number;
  byCategory: ICategorySummaryItem[];
}

export interface IExpenseResponse {
  id: string;
  pharmacyId: string;
  category: ExpenseCategory;
  amount: number;
  expenseDate: Date;
  note: string | null;
  attachmentPath: string | null;
  createdById: string;
  createdBy?: {
    id: string;
    name: string;
    role: Role;
  };
  createdAt: Date;
  updatedAt: Date;
}
