import * as XLSX from "xlsx";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import {
  MAX_IMPORT_ROWS,
  MEDICINE_SAMPLE_ROWS,
  MEDICINE_TEMPLATE_HEADERS,
  OPENING_STOCK_SAMPLE_ROWS,
  OPENING_STOCK_TEMPLATE_HEADERS,
} from "./excel_csv_import.constant";
import {
  isBatchExpired,
  parseExpiryMMYYYY,
} from "../medicines_management/medicines_management.helper";

/**
 * Generates an XLSX template in memory as a Buffer.
 */
export const generateTemplateBuffer = (
  type: "medicines" | "opening-stock"
): Buffer => {
  const wb = XLSX.utils.book_new();

  if (type === "medicines") {
    const ws = XLSX.utils.json_to_sheet(MEDICINE_SAMPLE_ROWS, {
      header: [...MEDICINE_TEMPLATE_HEADERS],
    });

    // Configure column widths for readability
    ws["!cols"] = [
      { wch: 20 }, // Name
      { wch: 20 }, // Generic Name
      { wch: 25 }, // Company
      { wch: 15 }, // Category
      { wch: 12 }, // Strength
      { wch: 15 }, // Dosage Form
      { wch: 16 }, // Barcode
      { wch: 16 }, // Min Stock Level
      { wch: 22 }, // Prescription Required
      { wch: 14 }, // Strip Factor
      { wch: 14 }, // Box Factor
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Medicines");
  } else {
    const ws = XLSX.utils.json_to_sheet(OPENING_STOCK_SAMPLE_ROWS, {
      header: [...OPENING_STOCK_TEMPLATE_HEADERS],
    });

    ws["!cols"] = [
      { wch: 20 }, // Name
      { wch: 12 }, // Strength
      { wch: 15 }, // Dosage Form
      { wch: 16 }, // Barcode
      { wch: 16 }, // Batch No
      { wch: 14 }, // Expiry Date
      { wch: 10 }, // Unit
      { wch: 12 }, // Quantity
      { wch: 16 }, // Purchase Price
      { wch: 16 }, // Selling Price
      { wch: 12 }, // MRP
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Opening Stock");
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

/**
 * Sanitizes untrusted cell values to prevent formula injection.
 * If cell starts with formula characters (=, +, -, @), strips or disarms it.
 */
export const sanitizeCellValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    // Formula triggers
    if (/^[=+\-@]/.test(trimmed)) {
      // Disarm formula by prefixing with a single quote or removing trigger
      return trimmed.replace(/^[=+\-@]+/, "").trim();
    }
    return trimmed;
  }
  return value;
};

export interface IParsedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  sanitized: Record<string, unknown>;
}

export interface IParsedFileResult {
  headers: string[];
  rows: IParsedRow[];
  totalRows: number;
}

/**
 * Safely parses an uploaded XLSX or CSV file buffer.
 */
export const parseUploadedSpreadsheet = (
  fileBuffer: Buffer,
  fileName: string
): IParsedFileResult => {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(fileBuffer, {
      type: "buffer",
      cellFormula: false,
      cellDates: false,
      raw: false,
    });
  } catch (error: any) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Failed to parse file '${fileName}'. The file may be corrupt or not a valid XLSX/CSV file.`
    );
  }

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Uploaded spreadsheet contains no sheets."
    );
  }

  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "The first worksheet is empty or invalid."
    );
  }

  // Convert to array of arrays to inspect headers and rows
  const rawAoa: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  if (rawAoa.length === 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "The uploaded file is empty (no headers or rows found)."
    );
  }

  const headerRow = rawAoa[0] as unknown[];
  const headers = headerRow.map((h) =>
    typeof h === "string" ? h.trim() : String(h || "").trim()
  );

  const dataRows = rawAoa.slice(1);

  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `File contains ${dataRows.length} rows, exceeding the maximum allowed limit of ${MAX_IMPORT_ROWS} rows.`
    );
  }

  const parsedRows: IParsedRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rowValues = dataRows[i];
    // Check if the entire row is empty
    const isAllEmpty = rowValues.every(
      (v) => v === undefined || v === null || String(v).trim() === ""
    );
    if (isAllEmpty) {
      continue; // Skip blank rows
    }

    const rawMap: Record<string, unknown> = {};
    const sanitizedMap: Record<string, unknown> = {};

    headers.forEach((header, colIdx) => {
      const rawVal = rowValues[colIdx];
      rawMap[header] = rawVal;
      sanitizedMap[header] = sanitizeCellValue(rawVal);
    });

    parsedRows.push({
      rowNumber: i + 2, // 1-indexed Excel row (row 1 is header)
      raw: rawMap,
      sanitized: sanitizedMap,
    });
  }

  return {
    headers,
    rows: parsedRows,
    totalRows: parsedRows.length,
  };
};

/**
 * Finds a cell value from a row using flexible header matching (case-insensitive & whitespace-tolerant).
 */
export const getRowValue = (
  row: Record<string, unknown>,
  candidates: string[]
): unknown => {
  const normalizedCandidateKeys = candidates.map((c) =>
    c.toLowerCase().replace(/[^a-z0-9]/g, "")
  );

  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normalizedCandidateKeys.includes(normalizedKey)) {
      return value;
    }
  }

  return undefined;
};

/**
 * Normalizes medicine composite duplicate key: `Name + Strength + DosageForm`
 */
export const normalizeMedicineKey = (
  name: string,
  strength?: string | null,
  dosageForm?: string | null
): string => {
  const normName = name.trim().toLowerCase().replace(/\s+/g, " ");
  const normStrength = (strength || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const normDosage = (dosageForm || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `${normName}|${normStrength}|${normDosage}`;
};

/**
 * Parses and validates an expiry string (MM/YYYY) or Excel date.
 */
export const parseAndValidateExpiry = (
  value: unknown,
  rowNumber: number
): { expiryDate: Date; display: string } => {
  if (!value) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Row ${rowNumber}: Expiry date is required.`
    );
  }

  let str = String(value).trim();

  // Handle format if user passed date like 2027-12-31 or 12-2027
  if (/^\d{4}-\d{2}/.test(str)) {
    const parts = str.split("-");
    str = `${parts[1]}/${parts[0]}`;
  } else if (/^(0[1-9]|1[0-2])-\d{4}$/.test(str)) {
    str = str.replace("-", "/");
  }

  let expiryDate: Date;
  try {
    expiryDate = parseExpiryMMYYYY(str);
  } catch (err: any) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Row ${rowNumber}: Expiry date '${str}' is invalid. Expected format is MM/YYYY (e.g. 12/2027).`
    );
  }

  if (isBatchExpired(expiryDate)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Row ${rowNumber}: Batch with expiry date '${str}' is already expired.`
    );
  }

  return { expiryDate, display: str };
};
