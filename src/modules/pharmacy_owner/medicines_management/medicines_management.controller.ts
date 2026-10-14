import { Request, Response } from "express";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { catchAsync } from "../../../shared/catchAsync";
import sendResponse from "../../../utils/sendResponse";
import { MedicinesManagementService } from "./medicines_management.service";

const getUserContext = (req: Request) => ({
  id: req.user.id,
  name: req.user.name,
  role: req.user.role,
});

const getClientMeta = (req: Request) => ({
  ip: (req.headers["x-forwarded-for"] as string) || req.ip || undefined,
  userAgent: req.headers["user-agent"] || undefined,
});

const createMedicine = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const user = getUserContext(req);
  const { ip, userAgent } = getClientMeta(req);

  const result = await MedicinesManagementService.createMedicine(
    pharmacyId,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Medicine created successfully",
    data: result,
  });
});

const quickAddMedicine = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const user = getUserContext(req);
  const { ip, userAgent } = getClientMeta(req);

  const result = await MedicinesManagementService.quickAddMedicine(
    pharmacyId,
    user,
    req.body,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Medicine quick added successfully",
    data: result,
  });
});

const updateMedicine = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const user = getUserContext(req);
  const { ip, userAgent } = getClientMeta(req);

  const result = await MedicinesManagementService.updateMedicine(
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
    message: "Medicine updated successfully",
    data: result,
  });
});

const changeMedicineStatus = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const user = getUserContext(req);
  const { ip, userAgent } = getClientMeta(req);

  const result = await MedicinesManagementService.changeMedicineStatus(
    pharmacyId,
    id as string,
    user,
    req.body.status,
    ip,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Medicine status updated successfully",
    data: result,
  });
});

const replaceMedicineUnits = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const user = getUserContext(req);
  const { ip, userAgent } = getClientMeta(req);

  const result = await MedicinesManagementService.replaceMedicineUnits(
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
    message: "Medicine unit conversions replaced successfully",
    data: result,
  });
});

const getMedicineBatches = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const result = await MedicinesManagementService.getMedicineBatches(
    pharmacyId,
    id as string,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Medicine batches retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getMedicines = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const result = await MedicinesManagementService.getMedicines(
    pharmacyId,
    req.query
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Medicines retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const lookupMedicineByBarcode = catchAsync(
  async (req: Request, res: Response) => {
    const pharmacyId = req.user?.pharmacyId;
    if (!pharmacyId) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Pharmacy ID not found for this user"
      );
    }

    const barcode = req.query.barcode as string;
    const result =
      await MedicinesManagementService.lookupMedicineByBarcode(
        pharmacyId,
        barcode
      );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Medicine retrieved successfully",
      data: result,
    });
  }
);

const searchMedicines = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const q = req.query.q as string;
  const result = await MedicinesManagementService.searchMedicines(
    pharmacyId,
    q
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Medicines retrieved successfully",
    data: result,
  });
});

const getMedicineById = catchAsync(async (req: Request, res: Response) => {
  const pharmacyId = req.user?.pharmacyId;
  if (!pharmacyId) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Pharmacy ID not found for this user"
    );
  }

  const { id } = req.params;
  const result = await MedicinesManagementService.getMedicineById(
    pharmacyId,
    id as string
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Medicine retrieved successfully",
    data: result,
  });
});

export const MedicinesManagementController = {
  createMedicine,
  quickAddMedicine,
  updateMedicine,
  changeMedicineStatus,
  replaceMedicineUnits,
  getMedicineBatches,
  getMedicines,
  lookupMedicineByBarcode,
  searchMedicines,
  getMedicineById,
};
