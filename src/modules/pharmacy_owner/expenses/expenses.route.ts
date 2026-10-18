import express, { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import { upload } from "../../../middlewares/upload";
import validateRequest from "../../../middlewares/validateRequest";
import { ExpenseController } from "./expenses.controller";
import { ExpenseValidation } from "./expenses.validation";

const router = express.Router();

/**
 * Middleware to parse JSON inside `data` field when submitted via multipart/form-data.
 */
const parseMultipartData = (req: Request, res: Response, next: NextFunction) => {
  if (req.body?.data) {
    try {
      const parsed =
        typeof req.body.data === "string"
          ? JSON.parse(req.body.data)
          : req.body.data;
      req.body = { ...parsed, ...req.body };
      delete req.body.data;
    } catch (error) {
      // Continue, Zod will catch invalid structures
    }
  }
  next();
};

/**
 * All expense endpoints are strictly restricted to PHARMACY_OWNER (OWN role).
 */

// 1. List expenses with category and date range filters
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER),
  validateRequest(ExpenseValidation.getExpensesQueryZodSchema),
  ExpenseController.getExpenses
);

// 2. Category-wise expense summary (MUST be defined before /:id)
router.get(
  "/summary",
  checkAuth(Role.PHARMACY_OWNER),
  validateRequest(ExpenseValidation.getExpensesSummaryQueryZodSchema),
  ExpenseController.getExpensesSummary
);

// 3. Create expense with optional attachment (multipart/form-data or application/json)
router.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER),
  upload.single("attachment"),
  parseMultipartData,
  validateRequest(ExpenseValidation.createExpenseZodSchema),
  ExpenseController.createExpense
);

// 4. Get expense details by ID
router.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER),
  ExpenseController.getExpenseById
);

// 5. Update expense with optional attachment replacement
router.patch(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER),
  upload.single("attachment"),
  parseMultipartData,
  validateRequest(ExpenseValidation.updateExpenseZodSchema),
  ExpenseController.updateExpense
);

// 6. Soft delete expense
router.delete(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER),
  ExpenseController.deleteExpense
);

export const ExpenseRoutes = router;
