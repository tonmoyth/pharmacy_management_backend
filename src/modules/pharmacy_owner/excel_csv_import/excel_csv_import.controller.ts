import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { ExcelCsvImportService } from "./excel_csv_import.service";
import { ALLOWED_FILE_EXTENSIONS } from "./excel_csv_import.constant";

const getUserContext = (req: Request) => ({
  id: req.user.id,
  name: req.user.name,
  role: req.user.role,
});

const getClientMeta = (req: Request) => ({
  ip: (req.headers["x-forwarded-for"] as string) || req.ip || undefined,
  userAgent: req.headers["user-agent"] || undefined,
});

/**
 * GET /imports/template
 * Download valid XLSX template for medicines or opening-stock.
 */
const getTemplate = catchAsync(async (req: Request, res: Response) => {
  const type = req.query.type as "medicines" | "opening-stock";

  if (!type || (type !== "medicines" && type !== "opening-stock")) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Query parameter 'type' must be either 'medicines' or 'opening-stock'."
    );
  }

  const { buffer, fileName, contentType } =
    ExcelCsvImportService.getTemplate(type);

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", buffer.length);
  res.status(httpStatus.OK).send(buffer);
});

/**
 * POST /imports/validate
 * Validates the uploaded XLSX or CSV file without modifying database records.
 */
const validateImport = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this authenticated user."
    );
  }

  if (!req.file) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Please upload a valid XLSX or CSV file."
    );
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (
    !ALLOWED_FILE_EXTENSIONS.includes(
      ext as (typeof ALLOWED_FILE_EXTENSIONS)[number]
    )
  ) {
    // Clean up temporary disk file
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Unsupported file format '${ext}'. Allowed formats are: ${ALLOWED_FILE_EXTENSIONS.join(", ")}.`
    );
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = fs.readFileSync(req.file.path);
  } finally {
    // Always clean up uploaded temporary disk file
    if (fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // Suppress unlink error
      }
    }
  }

  const type = (req.body.type || "").trim() as "medicines" | "opening-stock";
  if (!type || (type !== "medicines" && type !== "opening-stock")) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Field 'type' must be 'medicines' or 'opening-stock'."
    );
  }

  const duplicateMode = ((req.body.duplicateMode || "skip") as string)
    .trim()
    .toLowerCase() as "skip" | "update";

  if (duplicateMode !== "skip" && duplicateMode !== "update") {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Field 'duplicateMode' must be 'skip' or 'update'."
    );
  }

  const user = getUserContext(req);

  const result = await ExcelCsvImportService.validateImport(
    pharmacyId,
    user,
    fileBuffer,
    req.file.originalname,
    type,
    duplicateMode
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      result.status === "VALIDATED"
        ? "File validated successfully and ready for commit"
        : "File validation failed with errors",
    data: result,
  });
});

/**
 * POST /imports/:id/commit
 * Commits a previously validated import job.
 */
const commitImport = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this authenticated user."
    );
  }

  const user = getUserContext(req);
  const { ip, userAgent } = getClientMeta(req);
  const jobId = req.params.id as string;

  const result = await ExcelCsvImportService.commitImport(
    pharmacyId,
    user,
    jobId,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Import job committed successfully",
    data: result,
  });
});

/**
 * GET /imports
 * Returns authenticated Pharmacy's import history.
 */
const getImportHistory = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this authenticated user."
    );
  }

  const result = await ExcelCsvImportService.getImportHistory(
    pharmacyId,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Import history retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

/**
 * GET /imports/:id
 * Return details and row-level errors for a specific ImportJob.
 */
const getImportJobById = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this authenticated user."
    );
  }

  const jobId = req.params.id as string;
  const result = await ExcelCsvImportService.getImportJobById(
    pharmacyId,
    jobId
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Import job retrieved successfully",
    data: result,
  });
});

export const ExcelCsvImportController = {
  getTemplate,
  validateImport,
  commitImport,
  getImportHistory,
  getImportJobById,
};
