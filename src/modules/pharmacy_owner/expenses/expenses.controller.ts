import { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { ExpenseService } from "./expenses.service";
import { IExpenseUserContext } from "./expenses.interface";

const createExpense = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: IExpenseUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await ExpenseService.createExpense(
    pharmacyId,
    user,
    req.body,
    req.file,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Expense created successfully",
    data: result,
  });
});

const getExpenses = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const result = await ExpenseService.getExpenses(pharmacyId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Expenses retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getExpensesSummary = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const result = await ExpenseService.getExpensesSummary(pharmacyId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Expenses summary retrieved successfully",
    data: result,
  });
});

const getExpenseById = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const result = await ExpenseService.getExpenseById(
    pharmacyId,
    req.params.id as string
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Expense retrieved successfully",
    data: result,
  });
});

const updateExpense = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: IExpenseUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await ExpenseService.updateExpense(
    pharmacyId,
    user,
    req.params.id as string,
    req.body,
    req.file,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Expense updated successfully",
    data: result,
  });
});

const deleteExpense = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user.pharmacyId;
  const user: IExpenseUserContext = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };
  const ip = req.ip || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await ExpenseService.deleteExpense(
    pharmacyId,
    user,
    req.params.id as string,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: { id: result.id },
  });
});

export const ExpenseController = {
  createExpense,
  getExpenses,
  getExpensesSummary,
  getExpenseById,
  updateExpense,
  deleteExpense,
};
