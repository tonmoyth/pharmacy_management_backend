import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { CategoryService } from "./category.service";

const getCategories = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const result = await CategoryService.getCategories(pharmacyId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Categories retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getCategorySuggestions = catchAsync(async (req: Request, res: Response) => {
  const result = await CategoryService.getCategorySuggestions(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category suggestions retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const createCategory = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const user = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await CategoryService.createCategory(
    pharmacyId,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Category created successfully",
    data: result,
  });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const { id } = req.params;
  const user = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await CategoryService.updateCategory(
    pharmacyId,
    id as string,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category updated successfully",
    data: result,
  });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy ID not found for this user");
  }

  const { id } = req.params;
  const user = {
    id: req.user.id,
    name: req.user.name,
    role: req.user.role,
  };

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || undefined;
  const userAgent = req.headers["user-agent"] || undefined;

  const result = await CategoryService.deleteCategory(
    pharmacyId,
    id as string,
    user,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Category deleted successfully",
    data: result,
  });
});

export const CategoryController = {
  getCategories,
  getCategorySuggestions,
  createCategory,
  updateCategory,
  deleteCategory,
};
