import { MedicineStatus, Role, UnitName } from "@prisma/client";

export interface IMedicineUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface IUnitInput {
  unit: UnitName;
  piecesPerUnit: number;
}

export interface IFirstBatchInput {
  batchNo: string;
  expiry: string; // MM/YYYY format
  mrp?: number | null;
  purchasePrice: number;
  sellingPrice: number;
  quantity: number;
  unit: UnitName;
}

export interface ICreateMedicinePayload {
  name: string;
  genericName?: string | null;
  company?: string | null;
  categoryId?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  barcode?: string | null;
  minStockLevel?: number;
  isPrescriptionRequired?: boolean;
  units?: IUnitInput[];
}

export interface IQuickAddMedicinePayload extends ICreateMedicinePayload {
  firstBatch?: IFirstBatchInput;
}

export interface IUpdateMedicinePayload {
  name?: string;
  genericName?: string | null;
  company?: string | null;
  categoryId?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  barcode?: string | null;
  minStockLevel?: number;
  isPrescriptionRequired?: boolean;
}

export interface IChangeMedicineStatusPayload {
  status: MedicineStatus;
}

export interface IReplaceMedicineUnitsPayload {
  units: IUnitInput[];
}
