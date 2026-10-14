import { DuplicateMode, ImportStatus, ImportType, Role, UnitName } from "@prisma/client";

export interface IImportUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface IImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface IImportSkippedRow {
  row: number;
  reason: string;
  data?: Record<string, unknown>;
}

export interface IImportSummary {
  totalRows: number;
  validRows: number;
  skippedRows: number;
  errorRows: number;
}

export interface IValidatedMedicineRow {
  rowNumber: number;
  action: "CREATE" | "UPDATE" | "SKIP";
  targetMedicineId?: string;
  name: string;
  genericName?: string | null;
  company?: string | null;
  categoryName?: string | null;
  categoryId?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  barcode?: string | null;
  minStockLevel: number;
  isPrescriptionRequired: boolean;
  units: {
    unit: UnitName;
    piecesPerUnit: number;
  }[];
}

export interface IValidatedOpeningStockRow {
  rowNumber: number;
  medicineId: string;
  medicineName: string;
  batchNo: string;
  expiryDate: string; // ISO string for serialized storage in JSONB
  unit: UnitName;
  inputQuantity: number;
  piecesPerUnit: number;
  quantityPieces: number;
  purchasePrice: number;
  sellingPrice: number;
  mrp?: number | null;
}

export interface IImportJobData {
  errors: IImportRowError[];
  skippedRows: IImportSkippedRow[];
  validRows: (IValidatedMedicineRow | IValidatedOpeningStockRow)[];
  summary: IImportSummary;
}

export interface IImportValidationResult {
  jobId: string;
  type: ImportType;
  status: ImportStatus;
  fileName: string;
  duplicateMode: DuplicateMode;
  summary: IImportSummary;
  errors: IImportRowError[];
  skipped: IImportSkippedRow[];
}
