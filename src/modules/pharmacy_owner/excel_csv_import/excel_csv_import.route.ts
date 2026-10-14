import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import { upload } from "../../../middlewares/upload";
import validateRequest from "../../../middlewares/validateRequest";
import { ExcelCsvImportController } from "./excel_csv_import.controller";
import { ExcelCsvImportValidation } from "./excel_csv_import.validation";

const router = express.Router();

/**
 * Route 1: GET /template
 * Download valid XLSX template for medicines or opening-stock.
 * Registered before :id to prevent parameter collisions.
 */
router.get(
  "/template",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(ExcelCsvImportValidation.getTemplateQuerySchema),
  ExcelCsvImportController.getTemplate
);

/**
 * Route 2: POST /validate
 * Validates uploaded XLSX or CSV file without modifying database state.
 */
router.post(
  "/validate",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  upload.single("file"),
  validateRequest(ExcelCsvImportValidation.validateImportSchema),
  ExcelCsvImportController.validateImport
);

/**
 * Route 3: POST /:id/commit
 * Commits a previously validated import job in an atomic transaction.
 */
router.post(
  "/:id/commit",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(ExcelCsvImportValidation.commitImportSchema),
  ExcelCsvImportController.commitImport
);

/**
 * Route 4: GET /
 * Returns paginated import history for authenticated pharmacy.
 */
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(ExcelCsvImportValidation.getImportsQuerySchema),
  ExcelCsvImportController.getImportHistory
);

/**
 * Route 5: GET /:id
 * Returns job details and row errors for a specific ImportJob.
 */
router.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(ExcelCsvImportValidation.getImportByIdSchema),
  ExcelCsvImportController.getImportJobById
);

export const ExcelCsvImportRoutes = router;
