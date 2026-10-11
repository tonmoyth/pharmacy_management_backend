import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import validateRequest from "../../../middlewares/validateRequest";
import { CategoryController } from "./category.controller";
import { CategoryValidation } from "./category.validation";

const router = express.Router();

// Category suggestions across pharmacies (distinct names only)
router.get(
  "/suggestions",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF, Role.CASHIER),
  CategoryController.getCategorySuggestions
);

// List categories belonging to authenticated user's pharmacy
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF, Role.CASHIER),
  CategoryController.getCategories
);

// Create a category for the authenticated user's pharmacy
router.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(CategoryValidation.createCategoryZodSchema),
  CategoryController.createCategory
);

// Rename a category belonging to the authenticated user's pharmacy
router.patch(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(CategoryValidation.updateCategoryZodSchema),
  CategoryController.updateCategory
);

// Delete an unused category belonging to the authenticated user's pharmacy
router.delete(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  CategoryController.deleteCategory
);

export const CategoryRoutes = router;
