import httpStatus from "http-status";
import fs from "fs";
import { ExpenseCategory, PharmacyStatus, Role } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import AppError from "../../../errors/AppError";
import { QueryBuilder } from "../../../utils/queryBuilder";
import { cloudinaryService } from "../../../utils/cloudinary";
import {
  ALLOWED_EXPENSE_CATEGORIES,
  ALLOWED_EXPENSE_FILE_MIME_TYPES,
  EXPENSE_ERROR_CODES,
  expenseFilterableFields,
  expenseSearchableFields,
  MAX_EXPENSE_FILE_SIZE_BYTES,
} from "./expenses.constant";
import {
  ICategorySummaryItem,
  ICreateExpensePayload,
  IExpenseFilterQuery,
  IExpenseResponse,
  IExpenseSummaryQuery,
  IExpenseSummaryResponse,
  IExpenseUserContext,
  IUpdateExpensePayload,
} from "./expenses.interface";

const round2 = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

/**
 * Validates that the pharmacy exists and has ACTIVE status.
 */
const validatePharmacyActive = async (pharmacyId: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
  });

  if (!pharmacy) {
    throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  }

  if (pharmacy.status !== PharmacyStatus.ACTIVE) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Pharmacy account is suspended or inactive"
    );
  }

  return pharmacy;
};

/**
 * Validates and uploads an attachment file to Cloudinary.
 * Unlinks the temp file in all cases.
 */
const handleAttachmentUpload = async (
  file: Express.Multer.File
): Promise<string> => {
  if (!ALLOWED_EXPENSE_FILE_MIME_TYPES.includes(file.mimetype)) {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Invalid file type. Only JPEG, PNG, WEBP, and PDF files are allowed for expense attachments.",
      EXPENSE_ERROR_CODES.INVALID_FILE_TYPE
    );
  }

  if (file.size > MAX_EXPENSE_FILE_SIZE_BYTES) {
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Attachment file size cannot exceed 5MB.",
      EXPENSE_ERROR_CODES.FILE_TOO_LARGE
    );
  }

  const uploadResult = await cloudinaryService.uploadToCloudinary(
    file.path,
    "pharmacy-saas/expenses"
  );

  if (!uploadResult || !uploadResult.url) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to upload expense attachment to storage.",
      EXPENSE_ERROR_CODES.ATTACHMENT_UPLOAD_FAILED
    );
  }

  return uploadResult.url;
};

/**
 * Create a new expense.
 */
const createExpense = async (
  pharmacyId: string,
  user: IExpenseUserContext,
  payload: ICreateExpensePayload,
  file?: Express.Multer.File,
  ip?: string,
  userAgent?: string
): Promise<IExpenseResponse> => {
  await validatePharmacyActive(pharmacyId);

  if (!ALLOWED_EXPENSE_CATEGORIES.includes(payload.category)) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid expense category '${payload.category}'.`,
      EXPENSE_ERROR_CODES.INVALID_CATEGORY
    );
  }

  const amount = round2(payload.amount);
  if (amount <= 0) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Expense amount must be strictly greater than 0.",
      EXPENSE_ERROR_CODES.INVALID_AMOUNT
    );
  }

  const parsedDate = new Date(payload.expenseDate);
  if (isNaN(parsedDate.getTime())) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Invalid expense date format."
    );
  }

  let attachmentPath: string | null = null;
  if (file) {
    attachmentPath = await handleAttachmentUpload(file);
  }

  const expense = await prisma.expense.create({
    data: {
      pharmacyId,
      category: payload.category,
      amount,
      expenseDate: parsedDate,
      note: payload.note?.trim() || null,
      attachmentPath,
      createdById: user.id,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      pharmacyId,
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: "EXPENSE_CREATED",
      entityType: "Expense",
      entityId: expense.id,
      newValue: {
        id: expense.id,
        category: expense.category,
        amount,
        expenseDate: expense.expenseDate,
        hasAttachment: !!attachmentPath,
      },
      reason: `Created expense of ${amount.toFixed(2)} BDT under ${expense.category}`,
      ip,
      userAgent,
    },
  });

  return {
    id: expense.id,
    pharmacyId: expense.pharmacyId,
    category: expense.category,
    amount: round2(Number(expense.amount)),
    expenseDate: expense.expenseDate,
    note: expense.note,
    attachmentPath: expense.attachmentPath,
    createdById: expense.createdById,
    createdBy: expense.createdBy,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
};

/**
 * List expenses with category and date-range filters, pagination, and sorting.
 * Excludes soft-deleted records (deletedAt IS NOT NULL).
 */
const getExpenses = async (
  pharmacyId: string,
  query: IExpenseFilterQuery
) => {
  await validatePharmacyActive(pharmacyId);

  const normalizedQuery: Record<string, unknown> = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
  };
  delete normalizedQuery.search;

  // Extract date range filters before passing to QueryBuilder
  const from = query.from;
  const to = query.to;
  delete normalizedQuery.from;
  delete normalizedQuery.to;

  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (fromDate > toDate) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "'from' date cannot be later than 'to' date.",
        EXPENSE_ERROR_CODES.INVALID_DATE_RANGE
      );
    }
  }

  const expenseQuery = new QueryBuilder(
    prisma.expense,
    normalizedQuery as any,
    {
      searchableFields: expenseSearchableFields,
      filterableFields: expenseFilterableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate();

  // Strict tenant isolation and soft-delete exclusion
  expenseQuery.where({
    pharmacyId,
    deletedAt: null,
  });

  // Apply date range filter on expenseDate
  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) {
      dateFilter.gte = new Date(from);
    }
    if (to) {
      // End of day
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }
    expenseQuery.where({ expenseDate: dateFilter });
  }

  expenseQuery.include({
    createdBy: {
      select: {
        id: true,
        name: true,
        role: true,
      },
    },
  });

  const result = await expenseQuery.execute();

  const formattedData: IExpenseResponse[] = result.data.map((e: any) => ({
    id: e.id,
    pharmacyId: e.pharmacyId,
    category: e.category,
    amount: round2(Number(e.amount)),
    expenseDate: e.expenseDate,
    note: e.note,
    attachmentPath: e.attachmentPath,
    createdById: e.createdById,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));

  return {
    meta: result.meta,
    data: formattedData,
  };
};

/**
 * Get expense details by ID.
 * Excludes soft-deleted records.
 */
const getExpenseById = async (
  pharmacyId: string,
  expenseId: string
): Promise<IExpenseResponse> => {
  await validatePharmacyActive(pharmacyId);

  const expense = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      pharmacyId,
      deletedAt: null,
    },
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
  });

  if (!expense) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Expense not found",
      EXPENSE_ERROR_CODES.EXPENSE_NOT_FOUND
    );
  }

  return {
    id: expense.id,
    pharmacyId: expense.pharmacyId,
    category: expense.category,
    amount: round2(Number(expense.amount)),
    expenseDate: expense.expenseDate,
    note: expense.note,
    attachmentPath: expense.attachmentPath,
    createdById: expense.createdById,
    createdBy: expense.createdBy,
    createdAt: expense.createdAt,
    updatedAt: expense.updatedAt,
  };
};

/**
 * Update an existing expense.
 * Handles optional attachment replacement safely.
 */
const updateExpense = async (
  pharmacyId: string,
  user: IExpenseUserContext,
  expenseId: string,
  payload: IUpdateExpensePayload,
  file?: Express.Multer.File,
  ip?: string,
  userAgent?: string
): Promise<IExpenseResponse> => {
  await validatePharmacyActive(pharmacyId);

  const existingExpense = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      pharmacyId,
      deletedAt: null,
    },
  });

  if (!existingExpense) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Expense not found",
      EXPENSE_ERROR_CODES.EXPENSE_NOT_FOUND
    );
  }

  const updateData: Record<string, any> = {};

  if (payload.category !== undefined) {
    if (!ALLOWED_EXPENSE_CATEGORIES.includes(payload.category)) {
      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `Invalid expense category '${payload.category}'.`,
        EXPENSE_ERROR_CODES.INVALID_CATEGORY
      );
    }
    updateData.category = payload.category;
  }

  if (payload.amount !== undefined) {
    const amount = round2(payload.amount);
    if (amount <= 0) {
      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Expense amount must be strictly greater than 0.",
        EXPENSE_ERROR_CODES.INVALID_AMOUNT
      );
    }
    updateData.amount = amount;
  }

  if (payload.expenseDate !== undefined) {
    const parsedDate = new Date(payload.expenseDate);
    if (isNaN(parsedDate.getTime())) {
      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Invalid expense date format."
      );
    }
    updateData.expenseDate = parsedDate;
  }

  if (payload.note !== undefined) {
    updateData.note = payload.note?.trim() || null;
  }

  let newAttachmentUrl: string | null = null;
  if (file) {
    newAttachmentUrl = await handleAttachmentUpload(file);
    updateData.attachmentPath = newAttachmentUrl;
  }

  const updatedExpense = await prisma.expense.update({
    where: { id: expenseId },
    data: updateData,
    include: {
      createdBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
  });

  // If replacement succeeded and an old attachment existed, clean up old attachment asynchronously
  if (newAttachmentUrl && existingExpense.attachmentPath) {
    cloudinaryService.deleteFromCloudinary(existingExpense.attachmentPath).catch((err) => {
      console.warn("Failed to delete previous attachment from Cloudinary:", err);
    });
  }

  await prisma.auditLog.create({
    data: {
      pharmacyId,
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: "EXPENSE_UPDATED",
      entityType: "Expense",
      entityId: updatedExpense.id,
      oldValue: {
        category: existingExpense.category,
        amount: Number(existingExpense.amount),
        expenseDate: existingExpense.expenseDate,
        note: existingExpense.note,
        attachmentPath: existingExpense.attachmentPath,
      },
      newValue: {
        category: updatedExpense.category,
        amount: Number(updatedExpense.amount),
        expenseDate: updatedExpense.expenseDate,
        note: updatedExpense.note,
        attachmentPath: updatedExpense.attachmentPath,
      },
      reason: `Updated expense #${updatedExpense.id}`,
      ip,
      userAgent,
    },
  });

  return {
    id: updatedExpense.id,
    pharmacyId: updatedExpense.pharmacyId,
    category: updatedExpense.category,
    amount: round2(Number(updatedExpense.amount)),
    expenseDate: updatedExpense.expenseDate,
    note: updatedExpense.note,
    attachmentPath: updatedExpense.attachmentPath,
    createdById: updatedExpense.createdById,
    createdBy: updatedExpense.createdBy,
    createdAt: updatedExpense.createdAt,
    updatedAt: updatedExpense.updatedAt,
  };
};

/**
 * Soft delete an expense.
 * Sets deletedAt timestamp. Does not delete physically from database.
 */
const deleteExpense = async (
  pharmacyId: string,
  user: IExpenseUserContext,
  expenseId: string,
  ip?: string,
  userAgent?: string
): Promise<{ id: string; message: string }> => {
  await validatePharmacyActive(pharmacyId);

  const existingExpense = await prisma.expense.findFirst({
    where: {
      id: expenseId,
      pharmacyId,
      deletedAt: null,
    },
  });

  if (!existingExpense) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Expense not found",
      EXPENSE_ERROR_CODES.EXPENSE_NOT_FOUND
    );
  }

  const deletedAt = new Date();

  await prisma.expense.update({
    where: { id: expenseId },
    data: { deletedAt },
  });

  await prisma.auditLog.create({
    data: {
      pharmacyId,
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: "EXPENSE_DELETED",
      entityType: "Expense",
      entityId: expenseId,
      oldValue: {
        category: existingExpense.category,
        amount: Number(existingExpense.amount),
        expenseDate: existingExpense.expenseDate,
        note: existingExpense.note,
      },
      newValue: {
        deletedAt,
      },
      reason: `Soft deleted expense #${expenseId}`,
      ip,
      userAgent,
    },
  });

  return {
    id: expenseId,
    message: "Expense deleted successfully",
  };
};

/**
 * Category-wise expense summary with date-range filters.
 * Excludes soft-deleted expenses.
 */
const getExpensesSummary = async (
  pharmacyId: string,
  query: IExpenseSummaryQuery
): Promise<IExpenseSummaryResponse> => {
  await validatePharmacyActive(pharmacyId);

  const from = query.from;
  const to = query.to;

  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (fromDate > toDate) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "'from' date cannot be later than 'to' date.",
        EXPENSE_ERROR_CODES.INVALID_DATE_RANGE
      );
    }
  }

  const where: Record<string, any> = {
    pharmacyId,
    deletedAt: null,
  };

  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) {
      dateFilter.gte = new Date(from);
    }
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.lte = toDate;
    }
    where.expenseDate = dateFilter;
  }

  const categoryAgg = await prisma.expense.groupBy({
    by: ["category"],
    _sum: { amount: true },
    _count: { id: true },
    where,
    orderBy: { category: "asc" },
  });

  const byCategory: ICategorySummaryItem[] = categoryAgg.map((item) => ({
    category: item.category,
    totalAmount: round2(Number(item._sum.amount || 0)),
    count: item._count.id,
  }));

  const totalAmount = round2(
    byCategory.reduce((sum, item) => sum + item.totalAmount, 0)
  );
  const totalCount = byCategory.reduce((sum, item) => sum + item.count, 0);

  return {
    from,
    to,
    totalAmount,
    totalCount,
    byCategory,
  };
};

export const ExpenseService = {
  createExpense,
  getExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  getExpensesSummary,
};
