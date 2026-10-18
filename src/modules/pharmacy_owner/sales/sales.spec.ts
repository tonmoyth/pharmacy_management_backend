import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  DiscountType,
  DocType,
  MedicineStatus,
  PayMethod,
  PharmacyStatus,
  Role,
  SaleStatus,
  StockMovementType,
  UnitName,
  UserStatus,
} from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { redis } from "../../../config/redis";
import { SalesService } from "./sales.service";
import AppError from "../../../errors/AppError";
import { SALES_ERROR_CODES, SALES_WARNING_CODES } from "./sales.constant";

describe("Sales (POS) Module Integration & Business Logic Tests", () => {
  let pharmacyAId = "";
  let pharmacyBId = "";

  let ownerUserA: { id: string; name: string; role: Role };
  let cashierUserA: { id: string; name: string; role: Role };
  let staffUserA: { id: string; name: string; role: Role };

  let testCustomerAId = "";
  let testCustomerBId = "";
  let testCustomerWithLimitId = "";

  let medicineAId = "";
  let medicinePrescriptionAId = "";
  let medicineBId = "";

  let batchFefoEarlyId = "";
  let batchFefoLateId = "";
  let batchExpiredId = "";
  let batchPrescriptionId = "";
  let batchConcurrencyId = "";
  let batchCancellationId = "";

  const timestamp = Date.now();

  before(async () => {
    // 1. Setup Pharmacy A (maxDiscountPercent = 10%)
    const pharmacyA = await prisma.pharmacy.create({
      data: {
        name: `TEST_POS_PHARMACY_A_${timestamp}`,
        ownerName: "Owner POS A",
        phone: "01710000001",
        email: `pos_pharma_a_${timestamp}@example.com`,
        address: "Dhanmondi, Dhaka",
        city: "Dhaka",
        area: "Dhanmondi",
        maxDiscountPercent: 10,
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyAId = pharmacyA.id;

    // 2. Setup Pharmacy B (maxDiscountPercent = 5%)
    const pharmacyB = await prisma.pharmacy.create({
      data: {
        name: `TEST_POS_PHARMACY_B_${timestamp}`,
        ownerName: "Owner POS B",
        phone: "01710000002",
        email: `pos_pharma_b_${timestamp}@example.com`,
        address: "Gulshan, Dhaka",
        city: "Dhaka",
        area: "Gulshan",
        maxDiscountPercent: 5,
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyBId = pharmacyB.id;

    // 3. Setup Users for Pharmacy A
    const owner = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Owner User A",
        email: `pos_owner_${timestamp}@example.com`,
        role: Role.PHARMACY_OWNER,
        status: UserStatus.ACTIVE,
      },
    });
    ownerUserA = { id: owner.id, name: owner.name, role: owner.role };

    const cashier = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Cashier User A",
        email: `pos_cashier_${timestamp}@example.com`,
        role: Role.CASHIER,
        status: UserStatus.ACTIVE,
      },
    });
    cashierUserA = { id: cashier.id, name: cashier.name, role: cashier.role };

    const staff = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Staff User A",
        email: `pos_staff_${timestamp}@example.com`,
        role: Role.STAFF,
        status: UserStatus.ACTIVE,
      },
    });
    staffUserA = { id: staff.id, name: staff.name, role: staff.role };

    // 4. Setup Customers
    const customerA = await prisma.customer.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Regular Customer A",
        phone: `01711${String(timestamp).slice(-6)}`,
        dueBalance: 0,
        isActive: true,
      },
    });
    testCustomerAId = customerA.id;

    const customerWithLimit = await prisma.customer.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Credit Limit Customer",
        phone: `01712${String(timestamp).slice(-6)}`,
        creditLimit: 500,
        dueBalance: 400,
        isActive: true,
      },
    });
    testCustomerWithLimitId = customerWithLimit.id;

    const customerB = await prisma.customer.create({
      data: {
        pharmacyId: pharmacyBId,
        name: "Pharmacy B Customer",
        phone: `01713${String(timestamp).slice(-6)}`,
        dueBalance: 0,
        isActive: true,
      },
    });
    testCustomerBId = customerB.id;

    // 5. Setup Medicines
    const medicineA = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `TEST_POS_NAPA_${timestamp}`,
        genericName: "Paracetamol",
        strength: "500mg",
        dosageForm: "Tablet",
        status: MedicineStatus.ACTIVE,
        isPrescriptionRequired: false,
        units: {
          create: [
            { unit: UnitName.PIECE, piecesPerUnit: 1 },
            { unit: UnitName.STRIP, piecesPerUnit: 10 },
            { unit: UnitName.BOX, piecesPerUnit: 100 },
          ],
        },
      },
    });
    medicineAId = medicineA.id;

    const medicinePrescription = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `TEST_POS_AMOX_${timestamp}`,
        genericName: "Amoxicillin",
        strength: "500mg",
        dosageForm: "Capsule",
        status: MedicineStatus.ACTIVE,
        isPrescriptionRequired: true,
        units: {
          create: [
            { unit: UnitName.PIECE, piecesPerUnit: 1 },
            { unit: UnitName.STRIP, piecesPerUnit: 10 },
          ],
        },
      },
    });
    medicinePrescriptionAId = medicinePrescription.id;

    const medicineB = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyBId,
        name: `TEST_POS_MED_B_${timestamp}`,
        genericName: "Cefixime",
        strength: "200mg",
        dosageForm: "Capsule",
        status: MedicineStatus.ACTIVE,
        units: {
          create: [{ unit: UnitName.PIECE, piecesPerUnit: 1 }],
        },
      },
    });
    medicineBId = medicineB.id;

    // 6. Setup Batches
    const earlyBatch = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicineAId,
        batchNo: `BATCH-EARLY-${timestamp}`,
        expiryDate: new Date("2027-06-30"),
        purchasePrice: 2.0,
        sellingPrice: 3.0,
        receivedQty: 10,
        availableQty: 10,
      },
    });
    batchFefoEarlyId = earlyBatch.id;

    const lateBatch = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicineAId,
        batchNo: `BATCH-LATE-${timestamp}`,
        expiryDate: new Date("2028-12-31"),
        purchasePrice: 2.2,
        sellingPrice: 3.5,
        receivedQty: 20,
        availableQty: 20,
      },
    });
    batchFefoLateId = lateBatch.id;

    const expiredBatch = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicineAId,
        batchNo: `BATCH-EXPIRED-${timestamp}`,
        expiryDate: new Date("2023-01-31"),
        purchasePrice: 1.5,
        sellingPrice: 2.5,
        receivedQty: 50,
        availableQty: 50,
      },
    });
    batchExpiredId = expiredBatch.id;

    const prescriptionBatch = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicinePrescriptionAId,
        batchNo: `BATCH-RX-${timestamp}`,
        expiryDate: new Date("2027-10-31"),
        purchasePrice: 5.0,
        sellingPrice: 8.0,
        receivedQty: 50,
        availableQty: 50,
      },
    });
    batchPrescriptionId = prescriptionBatch.id;

    const concurrencyBatch = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicineAId,
        batchNo: `BATCH-CONC-${timestamp}`,
        expiryDate: new Date("2029-01-31"),
        purchasePrice: 2.0,
        sellingPrice: 4.0,
        receivedQty: 10,
        availableQty: 10,
      },
    });
    batchConcurrencyId = concurrencyBatch.id;

    const cancellationBatch = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicineAId,
        batchNo: `BATCH-CANCEL-${timestamp}`,
        expiryDate: new Date("2029-05-31"),
        purchasePrice: 2.5,
        sellingPrice: 5.0,
        receivedQty: 40,
        availableQty: 40,
      },
    });
    batchCancellationId = cancellationBatch.id;
  });

  after(async () => {
    try {
      await prisma.auditLog.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.stockMovement.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.saleReturnItem.deleteMany({
        where: { batch: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } },
      });
      await prisma.saleReturn.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.saleItem.deleteMany({
        where: {
          medicineId: { in: [medicineAId, medicinePrescriptionAId, medicineBId] },
        },
      });
      await prisma.sale.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.medicineBatch.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.medicineUnit.deleteMany({
        where: {
          medicineId: { in: [medicineAId, medicinePrescriptionAId, medicineBId] },
        },
      });
      await prisma.medicine.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.customer.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.documentCounter.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.user.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.pharmacy.deleteMany({
        where: { id: { in: [pharmacyAId, pharmacyBId] } },
      });
    } catch (err) {
      console.warn("Cleanup error (ignored):", err);
    } finally {
      await prisma.$disconnect();
      redis.disconnect();
    }
  });

  // --- Phase 1 POS Tests (1 - 20) ---

  test("1. Successful fully paid sale without customer (walk-in)", async () => {
    const result = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 2,
          batchId: batchFefoLateId,
        },
      ],
      paidAmount: 7.0,
      paymentMethod: PayMethod.CASH,
    });

    assert.ok(result.sale);
    assert.equal(result.sale.paidAmount, 7.0);
    assert.equal(result.sale.dueAmount, 0);
    assert.equal(result.sale.totalAmount, 7.0);
    assert.equal(result.sale.customerId, null);
    assert.equal(result.sale.status, SaleStatus.COMPLETED);
    assert.ok(result.sale.invoiceNo);

    const batch = await prisma.medicineBatch.findUnique({
      where: { id: batchFefoLateId },
    });
    assert.equal(batch?.availableQty, 18);

    const movement = await prisma.stockMovement.findFirst({
      where: {
        refId: result.sale.id as string,
        batchId: batchFefoLateId,
      },
    });
    assert.ok(movement);
    assert.equal(movement.quantityPieces, -2);
    assert.equal(movement.balanceAfter, 18);
    assert.equal(movement.type, StockMovementType.SALE);
  });

  test("2. Sale with customer due updates customer balance atomically", async () => {
    const initialCustomer = await prisma.customer.findUnique({
      where: { id: testCustomerAId },
    });
    const initialDue = Number(initialCustomer?.dueBalance || 0);

    const result = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      customerId: testCustomerAId,
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 2,
          batchId: batchFefoLateId,
        },
      ],
      paidAmount: 2.0,
      paymentMethod: PayMethod.CASH,
    });

    assert.equal(result.sale.totalAmount, 7.0);
    assert.equal(result.sale.paidAmount, 2.0);
    assert.equal(result.sale.dueAmount, 5.0);

    const updatedCustomer = await prisma.customer.findUnique({
      where: { id: testCustomerAId },
    });
    assert.equal(Number(updatedCustomer?.dueBalance), initialDue + 5.0);
  });

  test("3. Sale without a customer when due is positive returns CUSTOMER_REQUIRED_FOR_DUE", async () => {
    await assert.rejects(
      async () => {
        await SalesService.confirmSale(pharmacyAId, ownerUserA, {
          items: [
            {
              medicineId: medicineAId,
              unit: UnitName.PIECE,
              quantity: 2,
              batchId: batchFefoLateId,
            },
          ],
          paidAmount: 3.0,
          paymentMethod: PayMethod.CASH,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, SALES_ERROR_CODES.CUSTOMER_REQUIRED_FOR_DUE);
        return true;
      }
    );
  });

  test("4. FEFO allocation across multiple batches (10 from Batch 1, 5 from Batch 2)", async () => {
    const preview = await SalesService.previewSale(pharmacyAId, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 15,
        },
      ],
    });

    const result = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 15,
        },
      ],
      paidAmount: preview.totalAmount,
    });

    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].batchId, batchFefoEarlyId);
    assert.equal(result.items[0].quantityPieces, 10);
    assert.equal(result.items[1].batchId, batchFefoLateId);
    assert.equal(result.items[1].quantityPieces, 5);

    const earlyBatch = await prisma.medicineBatch.findUnique({
      where: { id: batchFefoEarlyId },
    });
    assert.equal(earlyBatch?.availableQty, 0);
  });

  test("5. Expired batches are skipped during automatic FEFO allocation", async () => {
    const preview = await SalesService.previewSale(pharmacyAId, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 5,
        },
      ],
    });

    assert.equal(preview.allocations.length, 1);
    assert.equal(preview.allocations[0].batchId, batchFefoLateId);
    assert.notEqual(preview.allocations[0].batchId, batchExpiredId);
  });

  test("6. Explicitly selected expired batch returns EXPIRED_BATCH", async () => {
    await assert.rejects(
      async () => {
        await SalesService.confirmSale(pharmacyAId, ownerUserA, {
          items: [
            {
              medicineId: medicineAId,
              unit: UnitName.PIECE,
              quantity: 1,
              batchId: batchExpiredId,
            },
          ],
          paidAmount: 2.5,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, SALES_ERROR_CODES.EXPIRED_BATCH);
        return true;
      }
    );
  });

  test("7. Insufficient stock returns INSUFFICIENT_STOCK", async () => {
    await assert.rejects(
      async () => {
        await SalesService.confirmSale(pharmacyAId, ownerUserA, {
          items: [
            {
              medicineId: medicineAId,
              unit: UnitName.PIECE,
              quantity: 500,
            },
          ],
          paidAmount: 2000,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, SALES_ERROR_CODES.INSUFFICIENT_STOCK);
        return true;
      }
    );
  });

  test("8. Invalid medicine, batch, or customer IDs throw 404", async () => {
    await assert.rejects(
      async () => {
        await SalesService.previewSale(pharmacyAId, {
          items: [
            {
              medicineId: "non_existent_med_id",
              unit: UnitName.PIECE,
              quantity: 1,
            },
          ],
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await SalesService.previewSale(pharmacyAId, {
          items: [
            {
              medicineId: medicineAId,
              unit: UnitName.PIECE,
              quantity: 1,
              batchId: "non_existent_batch_id",
            },
          ],
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await SalesService.confirmSale(pharmacyAId, ownerUserA, {
          customerId: "non_existent_cust_id",
          items: [
            {
              medicineId: medicineAId,
              unit: UnitName.PIECE,
              quantity: 1,
              batchId: batchFefoLateId,
            },
          ],
          paidAmount: 3.5,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  test("9. Cross-pharmacy access rejection (Medicine B requested under Pharmacy A)", async () => {
    await assert.rejects(
      async () => {
        await SalesService.previewSale(pharmacyAId, {
          items: [
            {
              medicineId: medicineBId,
              unit: UnitName.PIECE,
              quantity: 1,
            },
          ],
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  test("10. Invalid unit for medicine throws 400", async () => {
    await assert.rejects(
      async () => {
        await SalesService.previewSale(pharmacyAId, {
          items: [
            {
              medicineId: medicinePrescriptionAId,
              unit: UnitName.BOX,
              quantity: 1,
            },
          ],
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  test("11. Cashier discount within allowed limit (8% <= 10%) succeeds", async () => {
    const result = await SalesService.confirmSale(pharmacyAId, cashierUserA, {
      items: [
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 1,
          batchId: batchPrescriptionId,
        },
      ],
      discount: {
        type: DiscountType.PERCENT,
        value: 8,
      },
      paidAmount: 7.36,
    });

    assert.equal(result.sale.subtotal, 8.0);
    assert.equal(result.sale.discountAmount, 0.64);
    assert.equal(result.sale.totalAmount, 7.36);
    assert.equal(result.sale.paidAmount, 7.36);
  });

  test("12. Cashier/Staff discount exceeding limit (15% > 10%) returns DISCOUNT_LIMIT_EXCEEDED", async () => {
    await assert.rejects(
      async () => {
        await SalesService.confirmSale(pharmacyAId, cashierUserA, {
          items: [
            {
              medicineId: medicinePrescriptionAId,
              unit: UnitName.PIECE,
              quantity: 1,
              batchId: batchPrescriptionId,
            },
          ],
          discount: {
            type: DiscountType.PERCENT,
            value: 15,
          },
          paidAmount: 6.8,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, SALES_ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED);
        return true;
      }
    );

    const ownerResult = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 1,
          batchId: batchPrescriptionId,
        },
      ],
      discount: {
        type: DiscountType.PERCENT,
        value: 15,
      },
      paidAmount: 6.8,
    });
    assert.equal(ownerResult.sale.totalAmount, 6.8);
  });

  test("13. Fixed-discount authorization based on effective percentage", async () => {
    const allowed = await SalesService.confirmSale(pharmacyAId, staffUserA, {
      items: [
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 2,
          batchId: batchPrescriptionId,
        },
      ],
      discount: {
        type: DiscountType.FIXED,
        value: 1.0,
      },
      paidAmount: 15.0,
    });
    assert.equal(allowed.sale.discountAmount, 1.0);
    assert.equal(allowed.sale.totalAmount, 15.0);

    await assert.rejects(
      async () => {
        await SalesService.confirmSale(pharmacyAId, staffUserA, {
          items: [
            {
              medicineId: medicinePrescriptionAId,
              unit: UnitName.PIECE,
              quantity: 2,
              batchId: batchPrescriptionId,
            },
          ],
          discount: {
            type: DiscountType.FIXED,
            value: 3.0,
          },
          paidAmount: 13.0,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, SALES_ERROR_CODES.DISCOUNT_LIMIT_EXCEEDED);
        return true;
      }
    );
  });

  test("14. Preview performs no writes", async () => {
    const saleCountBefore = await prisma.sale.count({ where: { pharmacyId: pharmacyAId } });
    const batchBefore = await prisma.medicineBatch.findUnique({ where: { id: batchPrescriptionId } });
    const counterBefore = await prisma.documentCounter.findUnique({
      where: { pharmacyId_type: { pharmacyId: pharmacyAId, type: DocType.SALE } },
    });

    const preview = await SalesService.previewSale(pharmacyAId, {
      items: [
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 2,
        },
      ],
    });
    assert.ok(preview.subtotal > 0);

    const saleCountAfter = await prisma.sale.count({ where: { pharmacyId: pharmacyAId } });
    const batchAfter = await prisma.medicineBatch.findUnique({ where: { id: batchPrescriptionId } });
    const counterAfter = await prisma.documentCounter.findUnique({
      where: { pharmacyId_type: { pharmacyId: pharmacyAId, type: DocType.SALE } },
    });

    assert.equal(saleCountBefore, saleCountAfter);
    assert.equal(batchBefore?.availableQty, batchAfter?.availableQty);
    assert.equal(counterBefore?.lastNumber, counterAfter?.lastNumber);
  });

  test("15. Failed sale rolls back stock, sale records, and customer balance", async () => {
    const customerBefore = await prisma.customer.findUnique({ where: { id: testCustomerAId } });
    const batchBefore = await prisma.medicineBatch.findUnique({ where: { id: batchPrescriptionId } });

    await assert.rejects(
      async () => {
        await SalesService.confirmSale(pharmacyAId, ownerUserA, {
          customerId: testCustomerAId,
          items: [
            {
              medicineId: medicinePrescriptionAId,
              unit: UnitName.PIECE,
              quantity: 1,
              batchId: batchPrescriptionId,
            },
          ],
          paidAmount: 50.0,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    const customerAfter = await prisma.customer.findUnique({ where: { id: testCustomerAId } });
    const batchAfter = await prisma.medicineBatch.findUnique({ where: { id: batchPrescriptionId } });

    assert.equal(Number(customerBefore?.dueBalance), Number(customerAfter?.dueBalance));
    assert.equal(batchBefore?.availableQty, batchAfter?.availableQty);
  });

  test("16. Concurrent sales cannot oversell a batch", async () => {
    const salePayload = {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 7,
          batchId: batchConcurrencyId,
        },
      ],
      paidAmount: 28.0,
    };

    const results = await Promise.allSettled([
      SalesService.confirmSale(pharmacyAId, ownerUserA, salePayload),
      SalesService.confirmSale(pharmacyAId, ownerUserA, salePayload),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
    assert.equal(rejectedError.code, SALES_ERROR_CODES.INSUFFICIENT_STOCK);

    const batch = await prisma.medicineBatch.findUnique({
      where: { id: batchConcurrencyId },
    });
    assert.equal(batch?.availableQty, 3);
  });

  test("17. StockMovement quantities and SaleItem allocations match exactly", async () => {
    const result = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 2,
          batchId: batchPrescriptionId,
        },
      ],
      paidAmount: 16.0,
    });

    const saleItems = await prisma.saleItem.findMany({
      where: { saleId: result.sale.id as string },
    });
    const stockMovements = await prisma.stockMovement.findMany({
      where: { refId: result.sale.id as string },
    });

    assert.equal(saleItems.length, stockMovements.length);
    for (const item of saleItems) {
      const movement = stockMovements.find((m) => m.batchId === item.batchId);
      assert.ok(movement);
      assert.equal(movement.quantityPieces, -item.quantityPieces);
    }
  });

  test("18. Decimal-safe totals and discount calculations", async () => {
    const preview = await SalesService.previewSale(pharmacyAId, {
      items: [
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 3,
          batchId: batchPrescriptionId,
        },
      ],
      discount: {
        type: DiscountType.PERCENT,
        value: 10,
      },
    });

    assert.equal(preview.subtotal, 24.0);
    assert.equal(preview.discount.discountAmount, 2.4);
    assert.equal(preview.totalAmount, 21.6);
  });

  test("19. Invoice numbers are sequential and unique", async () => {
    const sale1 = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 1,
          batchId: batchPrescriptionId,
        },
      ],
      paidAmount: 8.0,
    });

    const sale2 = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 1,
          batchId: batchPrescriptionId,
        },
      ],
      paidAmount: 8.0,
    });

    assert.notEqual(sale1.sale.invoiceNo, sale2.sale.invoiceNo);
    assert.equal(
      sale2.sale.invoiceSeq as number,
      (sale1.sale.invoiceSeq as number) + 1
    );
  });

  test("20. Prescription and credit-limit warnings behave according to schema", async () => {
    const rxPreview = await SalesService.previewSale(pharmacyAId, {
      items: [
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 1,
          batchId: batchPrescriptionId,
        },
      ],
    });

    const rxWarning = rxPreview.warnings.find(
      (w) => w.code === SALES_WARNING_CODES.PRESCRIPTION_REQUIRED
    );
    assert.ok(rxWarning);
    assert.equal(rxWarning.medicineId, medicinePrescriptionAId);

    const limitExceededSale = await SalesService.confirmSale(
      pharmacyAId,
      ownerUserA,
      {
        customerId: testCustomerWithLimitId,
        items: [
          {
            medicineId: medicinePrescriptionAId,
            unit: UnitName.PIECE,
            quantity: 15,
            batchId: batchPrescriptionId,
          },
        ],
        paidAmount: 0,
      }
    );

    const creditWarning = limitExceededSale.warnings.find(
      (w) => w.code === SALES_WARNING_CODES.CREDIT_LIMIT_EXCEEDED
    );
    assert.ok(creditWarning);
    assert.equal(creditWarning.customerId, testCustomerWithLimitId);
  });

  // --- New Sales Listing, Lookup, Invoice, PDF, and Cancellation Tests (21 - 36) ---

  let cashierSaleInvoiceNo = "";
  let cashierSaleId = "";
  let ownerSaleId = "";
  let cancelTestSaleId = "";

  test("21. GET /sales: Owner sees all sales, Cashier & Staff see only own sales", async () => {
    // 1. Create a sale by Cashier
    const cashierSale = await SalesService.confirmSale(pharmacyAId, cashierUserA, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 1,
          batchId: batchCancellationId,
        },
      ],
      paidAmount: 5.0,
    });
    cashierSaleId = cashierSale.sale.id as string;
    cashierSaleInvoiceNo = cashierSale.sale.invoiceNo as string;

    // 2. Create a sale by Owner
    const ownerSale = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 1,
          batchId: batchCancellationId,
        },
      ],
      paidAmount: 5.0,
    });
    ownerSaleId = ownerSale.sale.id as string;

    // Owner listing: sees all sales in Pharmacy A
    const ownerList = await SalesService.getSales(pharmacyAId, ownerUserA, {});
    assert.ok(ownerList.data.length >= 2);
    const hasCashierSale = ownerList.data.some((s) => s.id === cashierSaleId);
    const hasOwnerSale = ownerList.data.some((s) => s.id === ownerSaleId);
    assert.ok(hasCashierSale);
    assert.ok(hasOwnerSale);

    // Cashier listing: sees ONLY sales created by Cashier
    const cashierList = await SalesService.getSales(pharmacyAId, cashierUserA, {});
    assert.ok(cashierList.data.every((s) => s.createdBy.id === cashierUserA.id));
    const cashierSawOwner = cashierList.data.some((s) => s.id === ownerSaleId);
    assert.equal(cashierSawOwner, false);

    // Staff listing: sees ONLY sales created by Staff
    const staffList = await SalesService.getSales(pharmacyAId, staffUserA, {});
    assert.ok(staffList.data.every((s) => s.createdBy.id === staffUserA.id));
  });

  test("22. GET /sales: Owner can filter by createdById; Cashier/Staff rejected if supplying different createdById", async () => {
    // Owner filters by Cashier
    const ownerFilter = await SalesService.getSales(pharmacyAId, ownerUserA, {
      createdById: cashierUserA.id,
    });
    assert.ok(ownerFilter.data.every((s) => s.createdBy.id === cashierUserA.id));

    // Cashier supplies Owner ID -> rejected with 403 Forbidden
    await assert.rejects(
      async () => {
        await SalesService.getSales(pharmacyAId, cashierUserA, {
          createdById: ownerUserA.id,
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  test("23. GET /sales: Filtering by date, invoiceNo, paymentStatus, and status works", async () => {
    // Filter by invoiceNo
    const invList = await SalesService.getSales(pharmacyAId, ownerUserA, {
      invoiceNo: cashierSaleInvoiceNo,
    });
    assert.equal(invList.data.length, 1);
    assert.equal(invList.data[0].invoiceNo, cashierSaleInvoiceNo);

    // Filter by paymentStatus = "paid"
    const paidList = await SalesService.getSales(pharmacyAId, ownerUserA, {
      paymentStatus: "paid",
    });
    assert.ok(paidList.data.every((s) => s.dueAmount === 0));

    // Filter by paymentStatus = "due"
    const dueList = await SalesService.getSales(pharmacyAId, ownerUserA, {
      paymentStatus: "due",
    });
    assert.ok(dueList.data.every((s) => s.dueAmount > 0));

    // Filter by status = "COMPLETED"
    const completedList = await SalesService.getSales(pharmacyAId, ownerUserA, {
      status: SaleStatus.COMPLETED,
    });
    assert.ok(completedList.data.every((s) => s.status === SaleStatus.COMPLETED));
  });

  test("24. GET /sales: Cross-pharmacy sales are never returned", async () => {
    const listA = await SalesService.getSales(pharmacyAId, ownerUserA, {});
    const listB = await SalesService.getSales(pharmacyBId, { id: "user_b", name: "Owner B", role: Role.PHARMACY_OWNER }, {});

    const listAIds = new Set(listA.data.map((s) => s.id));
    for (const sale of listB.data) {
      assert.ok(!listAIds.has(sale.id));
    }
  });

  test("25. Cost fields (costPricePerPiece) are hidden from Cashier and Staff in details and invoice", async () => {
    // Cashier fetches details of cashierSaleId
    const cashierView = await SalesService.getSaleById(pharmacyAId, cashierUserA, cashierSaleId);
    for (const item of cashierView.items) {
      assert.equal((item as any).costPricePerPiece, undefined);
    }

    // Cashier fetches invoice JSON
    const cashierInvoice = await SalesService.getSaleInvoiceJSON(pharmacyAId, cashierUserA, cashierSaleId);
    for (const item of cashierInvoice.items) {
      assert.equal(item.costPricePerPiece, undefined);
    }

    // Owner fetches details -> costPricePerPiece is present
    const ownerView = await SalesService.getSaleById(pharmacyAId, ownerUserA, cashierSaleId);
    for (const item of ownerView.items) {
      assert.ok(typeof item.costPricePerPiece === "number");
    }
  });

  test("26. GET /sales/by-invoice/:invoiceNo: Cashier can look up any invoice created by another employee in same pharmacy", async () => {
    // Look up ownerSaleId by its invoiceNo using Cashier context
    const ownerSale = await prisma.sale.findUnique({ where: { id: ownerSaleId } });
    assert.ok(ownerSale);

    const lookupResult = await SalesService.getSaleByInvoiceNo(pharmacyAId, cashierUserA, ownerSale.invoiceNo);
    assert.ok(lookupResult);
    assert.equal(lookupResult.id, ownerSaleId);
    assert.equal(lookupResult.createdBy.id, ownerUserA.id);
    // Cost fields still hidden from Cashier
    for (const item of lookupResult.items) {
      assert.equal((item as any).costPricePerPiece, undefined);
    }
  });

  test("27. GET /sales/by-invoice/:invoiceNo: Cross-pharmacy invoice lookup throws 404 without leaking info", async () => {
    // Look up Pharmacy A invoice from Pharmacy B context
    await assert.rejects(
      async () => {
        await SalesService.getSaleByInvoiceNo(pharmacyBId, { id: "user_b", name: "B", role: Role.PHARMACY_OWNER }, cashierSaleInvoiceNo);
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  test("28. GET /sales/:id: Cashier cannot view another employee's sale by ID (throws 404)", async () => {
    // Cashier attempts to access ownerSaleId directly
    await assert.rejects(
      async () => {
        await SalesService.getSaleById(pharmacyAId, cashierUserA, ownerSaleId);
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  test("29. Item-level returnable quantity is calculated correctly and handles returns", async () => {
    const sale = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 10,
          batchId: batchCancellationId,
        },
      ],
      paidAmount: 50.0,
    });

    const invoiceData = await SalesService.getSaleByInvoiceNo(
      pharmacyAId,
      ownerUserA,
      sale.sale.invoiceNo as string
    );

    assert.equal(invoiceData.items[0].quantityPieces, 10);
    assert.equal(invoiceData.items[0].returnedQtyPieces, 0);
    assert.equal(invoiceData.items[0].returnableQuantity, 10);

    // Simulate 3 pieces returned on this sale item
    await prisma.saleItem.update({
      where: { id: invoiceData.items[0].saleItemId },
      data: { returnedQtyPieces: 3 },
    });

    const updatedInvoiceData = await SalesService.getSaleByInvoiceNo(
      pharmacyAId,
      ownerUserA,
      sale.sale.invoiceNo as string
    );

    assert.equal(updatedInvoiceData.items[0].returnedQtyPieces, 3);
    assert.equal(updatedInvoiceData.items[0].returnableQuantity, 7);
  });

  test("30. Proportional discount shares reconcile with total discount without rounding drift", async () => {
    // Create a sale with 2 items and a fixed discount of 3.0 BDT
    const sale = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 2, // 2 * 5 = 10 BDT
          batchId: batchCancellationId,
        },
        {
          medicineId: medicinePrescriptionAId,
          unit: UnitName.PIECE,
          quantity: 1, // 1 * 8 = 8 BDT
          batchId: batchPrescriptionId,
        },
      ],
      discount: {
        type: DiscountType.FIXED,
        value: 3.0,
      },
      paidAmount: 15.0,
    });

    const invoiceData = await SalesService.getSaleInvoiceJSON(
      pharmacyAId,
      ownerUserA,
      sale.sale.id as string
    );

    const sumDiscountShares = invoiceData.items.reduce(
      (sum, item) => sum + item.discountShare,
      0
    );

    assert.equal(Math.round(sumDiscountShares * 100) / 100, 3.0);
    for (const item of invoiceData.items) {
      assert.equal(
        item.lineTotal,
        Math.round((item.lineSubtotal - item.discountShare) * 100) / 100
      );
    }
  });

  test("31. GET /sales/:id/invoice returns structured JSON with formatted Dhaka time and totals", async () => {
    const invoiceJSON = await SalesService.getSaleInvoiceJSON(
      pharmacyAId,
      ownerUserA,
      cashierSaleId
    );

    assert.ok(invoiceJSON.pharmacy.name);
    assert.ok(invoiceJSON.sale.invoiceNo);
    assert.ok(invoiceJSON.sale.soldAt);
    assert.equal(invoiceJSON.createdBy.id, cashierUserA.id);
    assert.ok(invoiceJSON.items.length > 0);
  });

  test("32. GET /sales/:id/invoice/pdf generates valid A4 and Thermal80 PDF buffers", async () => {
    // A4 PDF
    const a4Result = await SalesService.getSaleInvoicePDF(
      pharmacyAId,
      ownerUserA,
      cashierSaleId,
      "a4"
    );
    assert.ok(Buffer.isBuffer(a4Result.buffer));
    assert.ok(a4Result.buffer.length > 500);
    assert.equal(a4Result.buffer.subarray(0, 4).toString(), "%PDF");

    // Thermal80 PDF
    const thermalResult = await SalesService.getSaleInvoicePDF(
      pharmacyAId,
      ownerUserA,
      cashierSaleId,
      "thermal80"
    );
    assert.ok(Buffer.isBuffer(thermalResult.buffer));
    assert.ok(thermalResult.buffer.length > 300);
    assert.equal(thermalResult.buffer.subarray(0, 4).toString(), "%PDF");
  });

  test("33. GET /sales/:id/invoice/pdf: Rejects invalid paper size with 400; reprinting does not modify state", async () => {
    await assert.rejects(
      async () => {
        await SalesService.getSaleInvoicePDF(
          pharmacyAId,
          ownerUserA,
          cashierSaleId,
          "letter" as any
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    const batchBefore = await prisma.medicineBatch.findUnique({
      where: { id: batchCancellationId },
    });

    // Reprint multiple times
    await SalesService.getSaleInvoicePDF(pharmacyAId, ownerUserA, cashierSaleId, "a4");
    await SalesService.getSaleInvoicePDF(pharmacyAId, ownerUserA, cashierSaleId, "thermal80");

    const batchAfter = await prisma.medicineBatch.findUnique({
      where: { id: batchCancellationId },
    });

    assert.equal(batchBefore?.availableQty, batchAfter?.availableQty);
  });

  test("34. POST /sales/:id/cancel: Missing or blank cancellation reason is rejected", async () => {
    await assert.rejects(
      async () => {
        await SalesService.cancelSale(pharmacyAId, ownerUserA, cashierSaleId, {
          reason: "   ",
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  test("35. POST /sales/:id/cancel: Successful cancellation restores batch stock, customer due, and records cancelRefundAmount", async () => {
    // Setup sale to cancel
    const batchBefore = await prisma.medicineBatch.findUnique({
      where: { id: batchCancellationId },
    });
    const customerBefore = await prisma.customer.findUnique({
      where: { id: testCustomerAId },
    });

    const currentBatchQty = Number(batchBefore?.availableQty);
    const currentCustomerDue = Number(customerBefore?.dueBalance);

    // Create a sale with 4 pieces (4 * 5 = 20 BDT), paid 10, due 10
    const sale = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      customerId: testCustomerAId,
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 4,
          batchId: batchCancellationId,
        },
      ],
      paidAmount: 10.0,
      paymentMethod: PayMethod.CASH,
    });
    cancelTestSaleId = sale.sale.id as string;

    // Available quantity should have decreased by 4
    const batchMid = await prisma.medicineBatch.findUnique({
      where: { id: batchCancellationId },
    });
    assert.equal(batchMid?.availableQty, currentBatchQty - 4);

    // Customer due should have increased by 10
    const customerMid = await prisma.customer.findUnique({
      where: { id: testCustomerAId },
    });
    assert.equal(Number(customerMid?.dueBalance), currentCustomerDue + 10.0);

    // Now cancel the sale
    const cancelled = await SalesService.cancelSale(
      pharmacyAId,
      ownerUserA,
      cancelTestSaleId,
      {
        reason: "Customer changed mind immediately",
      }
    );

    assert.equal(cancelled.status, SaleStatus.CANCELLED);
    assert.equal(cancelled.cancelReason, "Customer changed mind immediately");
    assert.ok(cancelled.cancelledAt);
    assert.equal(cancelled.cancelledById, ownerUserA.id);
    assert.equal(cancelled.cancelRefundAmount, 10.0);
    assert.equal(cancelled.dueAmount, 0);

    // Stock must be restored exactly once
    const batchFinal = await prisma.medicineBatch.findUnique({
      where: { id: batchCancellationId },
    });
    assert.equal(batchFinal?.availableQty, currentBatchQty);

    // StockMovement SALE_CANCEL recorded
    const cancelMovement = await prisma.stockMovement.findFirst({
      where: {
        refId: cancelTestSaleId,
        type: StockMovementType.SALE_CANCEL,
      },
    });
    assert.ok(cancelMovement);
    assert.equal(cancelMovement.quantityPieces, 4); // positive restored
    assert.equal(cancelMovement.balanceAfter, currentBatchQty);

    // Customer due must be reduced back
    const customerFinal = await prisma.customer.findUnique({
      where: { id: testCustomerAId },
    });
    assert.equal(Number(customerFinal?.dueBalance), currentCustomerDue);

    // Audit log written
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        entityId: cancelTestSaleId,
        action: "SALE_CANCELLED",
      },
    });
    assert.ok(auditLog);
  });

  test("36. POST /sales/:id/cancel: Already cancelled, with returns, cross-creator, and concurrent cancellations handled safely", async () => {
    // 1. Already cancelled sale cannot be cancelled again
    await assert.rejects(
      async () => {
        await SalesService.cancelSale(pharmacyAId, ownerUserA, cancelTestSaleId, {
          reason: "Trying again",
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, SALES_ERROR_CODES.SALE_ALREADY_CANCELLED);
        return true;
      }
    );

    // 2. Sale with returns cannot be cancelled (409 Conflict)
    const saleWithReturn = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 2,
          batchId: batchCancellationId,
        },
      ],
      paidAmount: 10.0,
    });

    // Create a mock SaleReturn on this sale
    await prisma.saleReturn.create({
      data: {
        pharmacyId: pharmacyAId,
        saleId: saleWithReturn.sale.id as string,
        returnNo: `RET-${Date.now()}`,
        reason: "Damaged item returned",
        itemsAmount: 5.0,
        discountShare: 0,
        refundAmount: 5.0,
        createdById: ownerUserA.id,
      },
    });

    await assert.rejects(
      async () => {
        await SalesService.cancelSale(
          pharmacyAId,
          ownerUserA,
          saleWithReturn.sale.id as string,
          {
            reason: "Trying to cancel sale with return",
          }
        );
      },
      (err: any) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, SALES_ERROR_CODES.SALE_HAS_RETURNS);
        return true;
      }
    );

    // 3. Cashier cannot cancel another employee's sale (throws 404)
    await assert.rejects(
      async () => {
        await SalesService.cancelSale(pharmacyAId, cashierUserA, ownerSaleId, {
          reason: "Cashier cancelling owner sale",
        });
      },
      (err: any) => {
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    // 4. Concurrent cancellation requests cannot double-restore stock
    const saleForConcurrentCancel = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        {
          medicineId: medicineAId,
          unit: UnitName.PIECE,
          quantity: 3,
          batchId: batchCancellationId,
        },
      ],
      paidAmount: 15.0,
    });

    const batchBeforeCancel = await prisma.medicineBatch.findUnique({
      where: { id: batchCancellationId },
    });
    const batchBeforeCancelQty = Number(batchBeforeCancel?.availableQty);

    const concurrentResults = await Promise.allSettled([
      SalesService.cancelSale(
        pharmacyAId,
        ownerUserA,
        saleForConcurrentCancel.sale.id as string,
        { reason: "Concurrent cancel 1" }
      ),
      SalesService.cancelSale(
        pharmacyAId,
        ownerUserA,
        saleForConcurrentCancel.sale.id as string,
        { reason: "Concurrent cancel 2" }
      ),
    ]);

    const fulfilled = concurrentResults.filter((r) => r.status === "fulfilled");
    const rejected = concurrentResults.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const batchAfterCancel = await prisma.medicineBatch.findUnique({
      where: { id: batchCancellationId },
    });
    // Must restore exactly 3 pieces, never 6 pieces!
    assert.equal(batchAfterCancel?.availableQty, batchBeforeCancelQty + 3);
  });
});
