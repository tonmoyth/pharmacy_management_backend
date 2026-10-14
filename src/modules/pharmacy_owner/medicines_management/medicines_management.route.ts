import express from "express";
import { Role } from "@prisma/client";
import { checkAuth } from "../../../middlewares/checkAuth";
import validateRequest from "../../../middlewares/validateRequest";
import { MedicinesManagementController } from "./medicines_management.controller";
import { MedicinesManagementValidation } from "./medicines_management.validation";

const router = express.Router();

// Specific routes registered first to prevent conflicts with parameterized :id
router.get(
  "/lookup",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF, Role.CASHIER),
  validateRequest(MedicinesManagementValidation.barcodeLookupQuerySchema),
  MedicinesManagementController.lookupMedicineByBarcode
);

router.get(
  "/search",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF, Role.CASHIER),
  validateRequest(MedicinesManagementValidation.searchMedicinesQuerySchema),
  MedicinesManagementController.searchMedicines
);

// Quick Add Medicine (Flow A with firstBatch or Flow B without firstBatch)
router.post(
  "/quick-add",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF, Role.CASHIER),
  validateRequest(MedicinesManagementValidation.quickAddMedicineSchema),
  MedicinesManagementController.quickAddMedicine
);

// Create Medicine
router.post(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(MedicinesManagementValidation.createMedicineSchema),
  MedicinesManagementController.createMedicine
);

// Paginated Medicine List
router.get(
  "/",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF, Role.CASHIER),
  validateRequest(MedicinesManagementValidation.getMedicinesQuerySchema),
  MedicinesManagementController.getMedicines
);

// Sub-resources under :id
router.get(
  "/:id/batches",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF, Role.CASHIER),
  validateRequest(MedicinesManagementValidation.getMedicineBatchesSchema),
  MedicinesManagementController.getMedicineBatches
);

router.patch(
  "/:id/status",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(MedicinesManagementValidation.changeMedicineStatusSchema),
  MedicinesManagementController.changeMedicineStatus
);

router.put(
  "/:id/units",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(MedicinesManagementValidation.replaceMedicineUnitsSchema),
  MedicinesManagementController.replaceMedicineUnits
);

// Edit medicine
router.patch(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF),
  validateRequest(MedicinesManagementValidation.updateMedicineSchema),
  MedicinesManagementController.updateMedicine
);

// Get single medicine details
router.get(
  "/:id",
  checkAuth(Role.PHARMACY_OWNER, Role.STAFF, Role.CASHIER),
  validateRequest(MedicinesManagementValidation.getMedicineByIdSchema),
  MedicinesManagementController.getMedicineById
);

export const MedicinesManagementRoutes = router;
