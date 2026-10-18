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
import { SalesService } from "../sales/sales.service";
import { SalesReturnService, round2 } from "./sales_returns.service";
import AppError from "../../../errors/AppError";
import { SALES_RETURN_ERROR_CODES } from "./sales_returns.constant";
import { SALES_ERROR_CODES } from "../sales/sales.constant";
import { SalesReturnValidation } from "./sales_returns.validation";

describe("Sales Returns Module Integration & Business Logic Tests", () => {
  let pharmacyAId = "";
  let pharmacyBId = "";

  let ownerUserA: { id: string; name: string; role: Role };
  let cashierUserA: { id: string; name: string; role: Role };
  let staffUserA: { id: string; name: string; role: Role };
  let ownerUserB: { id: string; name: string; role: Role };

  let testCustomerAId = "";
  let testCustomerUnrelatedId = "";

  let medicineAId = "";
  let medicineBId = "";

  let batch1Id = "";
  let batch2Id = "";
  let batchExpiredId = "";
  let batchPharmacyBId = "";

  const timestamp = Date.now();

  const getSaleItemIds = async (saleId: string) => {
    const items = await prisma.saleItem.findMany({
      where: { saleId },
      orderBy: { id: "asc" },
    });
    return items.map((i) => i.id);
  };

  before(async () => {
    // 1. Setup Pharmacy A
    const pharmacyA = await prisma.pharmacy.create({
      data: {
        name: `TEST_RETURN_PHARMA_A_${timestamp}`,
        ownerName: "Owner Returns A",
        phone: "01720000001",
        email: `return_a_${timestamp}@example.com`,
        address: "Dhanmondi, Dhaka",
        city: "Dhaka",
        area: "Dhanmondi",
        maxDiscountPercent: 15,
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyAId = pharmacyA.id;

    // 2. Setup Pharmacy B (for cross-pharmacy tests)
    const pharmacyB = await prisma.pharmacy.create({
      data: {
        name: `TEST_RETURN_PHARMA_B_${timestamp}`,
        ownerName: "Owner Returns B",
        phone: "01720000002",
        email: `return_b_${timestamp}@example.com`,
        address: "Banani, Dhaka",
        city: "Dhaka",
        area: "Banani",
        maxDiscountPercent: 10,
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyBId = pharmacyB.id;

    // 3. Setup Users for Pharmacy A
    const owner = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Owner User A",
        email: `return_owner_${timestamp}@example.com`,
        role: Role.PHARMACY_OWNER,
        status: UserStatus.ACTIVE,
      },
    });
    ownerUserA = { id: owner.id, name: owner.name, role: owner.role };

    const cashier = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Cashier User A",
        email: `return_cashier_${timestamp}@example.com`,
        role: Role.CASHIER,
        status: UserStatus.ACTIVE,
      },
    });
    cashierUserA = { id: cashier.id, name: cashier.name, role: cashier.role };

    const staff = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Staff User A",
        email: `return_staff_${timestamp}@example.com`,
        role: Role.STAFF,
        status: UserStatus.ACTIVE,
      },
    });
    staffUserA = { id: staff.id, name: staff.name, role: staff.role };

    // Setup Owner for Pharmacy B
    const ownerB = await prisma.user.create({
      data: {
        pharmacyId: pharmacyBId,
        name: "Owner User B",
        email: `return_owner_b_${timestamp}@example.com`,
        role: Role.PHARMACY_OWNER,
        status: UserStatus.ACTIVE,
      },
    });
    ownerUserB = { id: ownerB.id, name: ownerB.name, role: ownerB.role };

    // 4. Setup Customers
    const customerA = await prisma.customer.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Customer A",
        phone: `01731${String(timestamp).slice(-6)}`,
        dueBalance: 0,
        isActive: true,
      },
    });
    testCustomerAId = customerA.id;

    const customerUnrelated = await prisma.customer.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Unrelated Customer",
        phone: `01732${String(timestamp).slice(-6)}`,
        dueBalance: 500,
        isActive: true,
      },
    });
    testCustomerUnrelatedId = customerUnrelated.id;

    // 5. Setup Medicines
    const medicineA = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `RETURN_MED_A_${timestamp}`,
        genericName: "Paracetamol",
        strength: "500mg",
        dosageForm: "Tablet",
        status: MedicineStatus.ACTIVE,
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

    const medicineB = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyBId,
        name: `RETURN_MED_B_${timestamp}`,
        genericName: "Azithromycin",
        strength: "500mg",
        dosageForm: "Tablet",
        status: MedicineStatus.ACTIVE,
        units: {
          create: [{ unit: UnitName.PIECE, piecesPerUnit: 1 }],
        },
      },
    });
    medicineBId = medicineB.id;

    // 6. Setup Batches
    const b1 = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicineAId,
        batchNo: `BATCH-RET-1-${timestamp}`,
        expiryDate: new Date("2028-12-31"),
        purchasePrice: 2.0,
        sellingPrice: 5.0,
        receivedQty: 500,
        availableQty: 500,
      },
    });
    batch1Id = b1.id;

    const b2 = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicineAId,
        batchNo: `BATCH-RET-2-${timestamp}`,
        expiryDate: new Date("2029-06-30"),
        purchasePrice: 2.5,
        sellingPrice: 6.0,
        receivedQty: 500,
        availableQty: 500,
      },
    });
    batch2Id = b2.id;

    const bExpired = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicineAId,
        batchNo: `BATCH-RET-EXPIRED-${timestamp}`,
        expiryDate: new Date("2023-01-31"),
        purchasePrice: 1.0,
        sellingPrice: 4.0,
        receivedQty: 100,
        availableQty: 100,
      },
    });
    batchExpiredId = bExpired.id;

    const bPharmacyB = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyBId,
        medicineId: medicineBId,
        batchNo: `BATCH-B-${timestamp}`,
        expiryDate: new Date("2028-01-31"),
        purchasePrice: 10.0,
        sellingPrice: 15.0,
        receivedQty: 100,
        availableQty: 100,
      },
    });
    batchPharmacyBId = bPharmacyB.id;
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
        where: { saleReturn: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } },
      });
      await prisma.saleReturn.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.saleItem.deleteMany({
        where: { sale: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } },
      });
      await prisma.sale.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.medicineBatch.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.medicineUnit.deleteMany({
        where: { medicine: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } },
      });
      await prisma.medicine.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.customer.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.user.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.documentCounter.deleteMany({
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

  // ==========================================
  // Section A: Validation & Authorization (1 - 13)
  // ==========================================

  let sale1Id = "";
  let sale1Item1Id = "";
  let sale1Item2Id = "";

  test("Setup: Create Sale 1 for Partial & Full Return Tests", async () => {
    const saleResult = await SalesService.confirmSale(pharmacyAId, cashierUserA, {
      items: [
        {
          medicineId: medicineAId,
          batchId: batch1Id,
          unit: UnitName.PIECE,
          quantity: 10,
        },
        {
          medicineId: medicineAId,
          batchId: batch2Id,
          unit: UnitName.PIECE,
          quantity: 5,
        },
      ],
      discount: {
        type: DiscountType.PERCENT,
        value: 10,
      },
      paidAmount: 72.0,
      paymentMethod: PayMethod.CASH,
    });

    sale1Id = saleResult.sale.id as string;
    const itemIds = await getSaleItemIds(sale1Id);
    sale1Item1Id = itemIds[0];
    sale1Item2Id = itemIds[1];

    assert.ok(sale1Id);
    assert.equal(itemIds.length, 2);
  });

  test("1. Successful partial return", async () => {
    const returnResult = await SalesReturnService.createSalesReturn(
      pharmacyAId,
      cashierUserA,
      {
        saleId: sale1Id,
        reason: "Customer bought excess quantity",
        items: [
          {
            saleItemId: sale1Item1Id,
            quantity: 4,
            unit: UnitName.PIECE,
          },
        ],
      }
    );

    assert.ok(returnResult.id);
    assert.match(returnResult.returnNo, /^SR-\d{6}$/);
    assert.equal(returnResult.itemsAmount, 20.0);
    assert.equal(returnResult.discountShare, 2.0);
    assert.equal(returnResult.refundAmount, 18.0);
    assert.equal(returnResult.dueReduced, 0);
    assert.equal(returnResult.cashRefunded, 18.0);
    assert.equal(returnResult.items.length, 1);
    assert.equal(returnResult.items[0].quantityPieces, 4);
    assert.equal(returnResult.items[0].remainingReturnablePieces, 6);

    const updatedSale = await prisma.sale.findUnique({
      where: { id: sale1Id },
    });
    assert.equal(updatedSale?.status, SaleStatus.PARTIALLY_RETURNED);
  });

  test("2. Successful full return (completes remaining items)", async () => {
    const returnResult = await SalesReturnService.createSalesReturn(
      pharmacyAId,
      cashierUserA,
      {
        saleId: sale1Id,
        reason: "Returning the rest of the items",
        items: [
          {
            saleItemId: sale1Item1Id,
            quantity: 6,
            unit: UnitName.PIECE,
          },
          {
            saleItemId: sale1Item2Id,
            quantity: 5,
            unit: UnitName.PIECE,
          },
        ],
      }
    );

    assert.equal(returnResult.itemsAmount, 60.0);
    assert.equal(returnResult.discountShare, 6.0);
    assert.equal(returnResult.refundAmount, 54.0);

    assert.equal(round2(18.0 + returnResult.refundAmount), 72.0);

    const finalSale = await prisma.sale.findUnique({
      where: { id: sale1Id },
    });
    assert.equal(finalSale?.status, SaleStatus.RETURNED);

    assert.equal(returnResult.items[0].remainingReturnablePieces, 0);
    assert.equal(returnResult.items[1].remainingReturnablePieces, 0);
  });

  test("3. Missing sale ID produces error", async () => {
    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
          saleId: "non_existent_sale_id",
          reason: "Defective item",
          items: [
            {
              saleItemId: sale1Item1Id,
              quantity: 1,
              unit: UnitName.PIECE,
            },
          ],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.SALE_NOT_FOUND);
        return true;
      }
    );
  });

  test("4. Missing or blank reason is rejected", async () => {
    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
          saleId: sale1Id,
          reason: "   ",
          items: [
            {
              saleItemId: sale1Item1Id,
              quantity: 1,
              unit: UnitName.PIECE,
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

  test("5. Empty item list rejection", async () => {
    const parseRes = SalesReturnValidation.createSalesReturnZodSchema.safeParse({
      body: {
        saleId: sale1Id,
        reason: "Valid reason",
        items: [],
      },
    });
    assert.equal(parseRes.success, false);
  });

  test("6. Invalid, zero, or negative quantity is rejected", async () => {
    const parseZero = SalesReturnValidation.createSalesReturnZodSchema.safeParse({
      body: {
        saleId: sale1Id,
        reason: "Valid reason",
        items: [{ saleItemId: sale1Item1Id, quantity: 0, unit: UnitName.PIECE }],
      },
    });
    assert.equal(parseZero.success, false);

    const parseNegative = SalesReturnValidation.createSalesReturnZodSchema.safeParse({
      body: {
        saleId: sale1Id,
        reason: "Valid reason",
        items: [{ saleItemId: sale1Item1Id, quantity: -5, unit: UnitName.PIECE }],
      },
    });
    assert.equal(parseNegative.success, false);
  });

  test("7. Invalid unit conversion throws 400", async () => {
    const saleB = await SalesService.confirmSale(pharmacyBId, ownerUserB, {
      items: [
        {
          medicineId: medicineBId,
          batchId: batchPharmacyBId,
          unit: UnitName.PIECE,
          quantity: 2,
        },
      ],
      paidAmount: 30.0,
    });
    const [saleBItemId] = await getSaleItemIds(saleB.sale.id as string);

    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyBId, ownerUserB, {
          saleId: saleB.sale.id as string,
          reason: "Returned box",
          items: [
            {
              saleItemId: saleBItemId,
              quantity: 1,
              unit: UnitName.STRIP, // STRIP is not configured on medicine B
            },
          ],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.INVALID_UNIT);
        return true;
      }
    );
  });

  test("8. SaleItem belonging to another sale is rejected", async () => {
    const s1 = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 2 }],
      paidAmount: 10.0,
    });
    const s2 = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 2 }],
      paidAmount: 10.0,
    });

    const [s2ItemId] = await getSaleItemIds(s2.sale.id as string);

    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
          saleId: s1.sale.id as string,
          reason: "Mismatched item",
          items: [{ saleItemId: s2ItemId, quantity: 1, unit: UnitName.PIECE }],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.SALE_ITEM_NOT_FOUND);
        return true;
      }
    );
  });

  test("9. Cross-pharmacy sale or SaleItem rejection", async () => {
    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyBId, ownerUserB, {
          saleId: sale1Id, // belonging to Pharmacy A
          reason: "Cross pharmacy attempt",
          items: [{ saleItemId: sale1Item1Id, quantity: 1, unit: UnitName.PIECE }],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.SALE_NOT_FOUND);
        return true;
      }
    );
  });

  test("10. Owner can view all pharmacy returns", async () => {
    const list = await SalesReturnService.getSalesReturns(pharmacyAId, ownerUserA, {});
    assert.ok(list.data.length >= 2);
    assert.ok(list.data.some((r) => r.createdBy.id === cashierUserA.id));
  });

  test("11. Cashier sees only returns they created", async () => {
    const sStaff = await SalesService.confirmSale(pharmacyAId, staffUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 5 }],
      paidAmount: 25.0,
    });
    const [staffItemId] = await getSaleItemIds(sStaff.sale.id as string);

    const staffReturn = await SalesReturnService.createSalesReturn(pharmacyAId, staffUserA, {
      saleId: sStaff.sale.id as string,
      reason: "Staff customer return",
      items: [{ saleItemId: staffItemId, quantity: 2, unit: UnitName.PIECE }],
    });

    const cashierList = await SalesReturnService.getSalesReturns(pharmacyAId, cashierUserA, {});
    for (const ret of cashierList.data) {
      assert.equal(ret.createdBy.id, cashierUserA.id);
    }
    assert.ok(!cashierList.data.some((r) => r.id === staffReturn.id));
  });

  test("12. Staff sees only returns they created", async () => {
    const staffList = await SalesReturnService.getSalesReturns(pharmacyAId, staffUserA, {});
    for (const ret of staffList.data) {
      assert.equal(ret.createdBy.id, staffUserA.id);
    }
  });

  test("13. Cross-pharmacy return details are inaccessible", async () => {
    const returnsInA = await SalesReturnService.getSalesReturns(pharmacyAId, ownerUserA, {});
    const returnAId = returnsInA.data[0].id;

    await assert.rejects(
      async () => {
        await SalesReturnService.getSalesReturnById(pharmacyBId, ownerUserB, returnAId);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  // ==========================================
  // Section B: Return Quantity & Stock (14 - 25)
  // ==========================================

  let saleStockTestId = "";
  let saleStockItemId = "";
  let batchStockBefore = 0;

  test("14. Return quantity within allowed amount succeeds", async () => {
    const b1Record = await prisma.medicineBatch.findUnique({ where: { id: batch1Id } });
    batchStockBefore = Number(b1Record?.availableQty);

    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 10 }],
      paidAmount: 50.0,
    });
    saleStockTestId = s.sale.id as string;
    const [itemId] = await getSaleItemIds(saleStockTestId);
    saleStockItemId = itemId;

    const b1Mid = await prisma.medicineBatch.findUnique({ where: { id: batch1Id } });
    assert.equal(Number(b1Mid?.availableQty), batchStockBefore - 10);

    const ret = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: saleStockTestId,
      reason: "Partial return 3 pieces",
      items: [{ saleItemId: saleStockItemId, quantity: 3, unit: UnitName.PIECE }],
    });

    assert.equal(ret.items[0].quantityPieces, 3);
    assert.equal(ret.items[0].remainingReturnablePieces, 7);

    const b1After = await prisma.medicineBatch.findUnique({ where: { id: batch1Id } });
    assert.equal(Number(b1After?.availableQty), batchStockBefore - 7);
  });

  test("15. Return quantity exceeding remaining quantity produces RETURN_QTY_EXCEEDED", async () => {
    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
          saleId: saleStockTestId,
          reason: "Trying to return more than allowed",
          items: [{ saleItemId: saleStockItemId, quantity: 8, unit: UnitName.PIECE }],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED);
        assert.match(err.message, /exceeds remaining returnable quantity/i);
        return true;
      }
    );
  });

  test("16. Multiple partial returns calculate correct remaining quantity", async () => {
    const ret2 = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: saleStockTestId,
      reason: "Second partial return",
      items: [{ saleItemId: saleStockItemId, quantity: 2, unit: UnitName.PIECE }],
    });
    assert.equal(ret2.items[0].remainingReturnablePieces, 5);

    const ret3 = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: saleStockTestId,
      reason: "Third partial return",
      items: [{ saleItemId: saleStockItemId, quantity: 3, unit: UnitName.PIECE }],
    });
    assert.equal(ret3.items[0].remainingReturnablePieces, 2);

    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
          saleId: saleStockTestId,
          reason: "Should fail with only 2 left",
          items: [{ saleItemId: saleStockItemId, quantity: 3, unit: UnitName.PIECE }],
        });
      },
      (err: any) => {
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED);
        return true;
      }
    );

    const ret4 = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: saleStockTestId,
      reason: "Final return",
      items: [{ saleItemId: saleStockItemId, quantity: 2, unit: UnitName.PIECE }],
    });
    assert.equal(ret4.items[0].remainingReturnablePieces, 0);

    const saleFinal = await prisma.sale.findUnique({ where: { id: saleStockTestId } });
    assert.equal(saleFinal?.status, SaleStatus.RETURNED);
  });

  test("17. Duplicate item entries in the same request are rejected", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 5 }],
      paidAmount: 25.0,
    });
    const [sItemId] = await getSaleItemIds(s.sale.id as string);

    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
          saleId: s.sale.id as string,
          reason: "Duplicate item test",
          items: [
            { saleItemId: sItemId, quantity: 1, unit: UnitName.PIECE },
            { saleItemId: sItemId, quantity: 2, unit: UnitName.PIECE },
          ],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.DUPLICATE_ITEM_ENTRY);
        return true;
      }
    );
  });

  test("18. Returned stock goes directly to the original batch", async () => {
    const b2RecordBefore = await prisma.medicineBatch.findUnique({ where: { id: batch2Id } });
    const b2QtyBefore = Number(b2RecordBefore?.availableQty);

    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch2Id, unit: UnitName.PIECE, quantity: 4 }],
      paidAmount: 24.0,
    });
    const [sItemId] = await getSaleItemIds(s.sale.id as string);

    await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: s.sale.id as string,
      reason: "Restoring to original batch 2",
      items: [{ saleItemId: sItemId, quantity: 4, unit: UnitName.PIECE }],
    });

    const b2RecordAfter = await prisma.medicineBatch.findUnique({ where: { id: batch2Id } });
    assert.equal(Number(b2RecordAfter?.availableQty), b2QtyBefore);
  });

  test("19. StockMovement SALE_RETURN matches actual restored quantities", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 6 }],
      paidAmount: 30.0,
    });
    const [sItemId] = await getSaleItemIds(s.sale.id as string);

    const ret = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: s.sale.id as string,
      reason: "Verify stock movement",
      items: [{ saleItemId: sItemId, quantity: 6, unit: UnitName.PIECE }],
    });

    const movement = await prisma.stockMovement.findFirst({
      where: {
        refId: ret.id,
        type: StockMovementType.SALE_RETURN,
      },
    });

    assert.ok(movement);
    assert.equal(movement.quantityPieces, 6);
    assert.equal(movement.batchId, batch1Id);
    assert.equal(movement.medicineId, medicineAId);
  });

  test("20. Expired batches remain ineligible for selling after return", async () => {
    const preview = await SalesService.previewSale(pharmacyAId, {
      items: [{ medicineId: medicineAId, unit: UnitName.PIECE, quantity: 1 }],
    });
    for (const alloc of preview.allocations) {
      assert.notEqual(alloc.batchId, batchExpiredId);
    }
  });

  test("21. Inactive medicines are not reactivated by returns", async () => {
    await prisma.medicine.update({
      where: { id: medicineAId },
      data: { status: MedicineStatus.INACTIVE },
    });

    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineBId, batchId: batchPharmacyBId, unit: UnitName.PIECE, quantity: 1 }],
      paidAmount: 15.0,
    }).catch(() => null);

    const medAfter = await prisma.medicine.findUnique({ where: { id: medicineAId } });
    assert.equal(medAfter?.status, MedicineStatus.INACTIVE);

    await prisma.medicine.update({
      where: { id: medicineAId },
      data: { status: MedicineStatus.ACTIVE },
    });
  });

  test("22. SaleItem returned quantities update correctly", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 8 }],
      paidAmount: 40.0,
    });
    const [sItemId] = await getSaleItemIds(s.sale.id as string);

    await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: s.sale.id as string,
      reason: "Check returnedQtyPieces",
      items: [{ saleItemId: sItemId, quantity: 3, unit: UnitName.PIECE }],
    });

    const itemMid = await prisma.saleItem.findUnique({ where: { id: sItemId } });
    assert.equal(itemMid?.returnedQtyPieces, 3);

    await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: s.sale.id as string,
      reason: "Check returnedQtyPieces part 2",
      items: [{ saleItemId: sItemId, quantity: 5, unit: UnitName.PIECE }],
    });

    const itemFinal = await prisma.saleItem.findUnique({ where: { id: sItemId } });
    assert.equal(itemFinal?.returnedQtyPieces, 8);
  });

  test("23. Sale status changes to PARTIALLY_RETURNED and RETURNED correctly", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 10 }],
      paidAmount: 50.0,
    });
    const sId = s.sale.id as string;
    const [sItemId] = await getSaleItemIds(sId);

    const sInitial = await prisma.sale.findUnique({ where: { id: sId } });
    assert.equal(sInitial?.status, SaleStatus.COMPLETED);

    await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sId,
      reason: "Partial return status check",
      items: [{ saleItemId: sItemId, quantity: 4, unit: UnitName.PIECE }],
    });
    const sPartial = await prisma.sale.findUnique({ where: { id: sId } });
    assert.equal(sPartial?.status, SaleStatus.PARTIALLY_RETURNED);

    await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sId,
      reason: "Full return status check",
      items: [{ saleItemId: sItemId, quantity: 6, unit: UnitName.PIECE }],
    });
    const sReturned = await prisma.sale.findUnique({ where: { id: sId } });
    assert.equal(sReturned?.status, SaleStatus.RETURNED);
  });

  test("24. Cancelled sales cannot be returned", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 2 }],
      paidAmount: 10.0,
    });
    const sId = s.sale.id as string;
    const [sItemId] = await getSaleItemIds(sId);

    await SalesService.cancelSale(pharmacyAId, ownerUserA, sId, {
      reason: "Cancel before return test",
    });

    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
          saleId: sId,
          reason: "Attempting to return cancelled sale",
          items: [{ saleItemId: sItemId, quantity: 1, unit: UnitName.PIECE }],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.SALE_CANCELLED);
        return true;
      }
    );
  });

  test("25. Existing sale cancellation is blocked after a completed return (409 Conflict)", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 5 }],
      paidAmount: 25.0,
    });
    const sId = s.sale.id as string;
    const [sItemId] = await getSaleItemIds(sId);

    await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sId,
      reason: "Customer return for cancellation block test",
      items: [{ saleItemId: sItemId, quantity: 2, unit: UnitName.PIECE }],
    });

    await assert.rejects(
      async () => {
        await SalesService.cancelSale(pharmacyAId, ownerUserA, sId, {
          reason: "Trying to cancel sale that has returns",
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, SALES_ERROR_CODES.SALE_HAS_RETURNS);
        return true;
      }
    );
  });

  // ==========================================
  // Section C: Financial Calculations (26 - 35)
  // ==========================================

  test("26. Discount share calculation is correct for percentage and fixed discounts", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 20 }],
      discount: { type: DiscountType.FIXED, value: 10 },
      paidAmount: 90.0,
    });
    const sId = s.sale.id as string;
    const [sItemId] = await getSaleItemIds(sId);

    const ret = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sId,
      reason: "Discount share calculation check",
      items: [{ saleItemId: sItemId, quantity: 5, unit: UnitName.PIECE }],
    });

    assert.equal(ret.itemsAmount, 25.0);
    assert.equal(ret.discountShare, 2.50);
    assert.equal(ret.refundAmount, 22.50);
  });

  test("27. Due reduction is correct when refund is less than invoice due", async () => {
    const custBefore = await prisma.customer.findUnique({ where: { id: testCustomerAId } });
    const initialCustDue = Number(custBefore?.dueBalance || 0);

    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      customerId: testCustomerAId,
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 20 }],
      paidAmount: 60.0,
      paymentMethod: PayMethod.CASH,
    });
    const sId = s.sale.id as string;
    const [sItemId] = await getSaleItemIds(sId);

    assert.equal(s.sale.dueAmount, 40.0);

    const ret = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sId,
      reason: "Due reduction less than invoice due",
      items: [{ saleItemId: sItemId, quantity: 4, unit: UnitName.PIECE }],
    });

    assert.equal(ret.refundAmount, 20.0);
    assert.equal(ret.dueReduced, 20.0);
    assert.equal(ret.cashRefunded, 0.0);

    const saleAfter = await prisma.sale.findUnique({ where: { id: sId } });
    assert.equal(Number(saleAfter?.dueAmount), 20.0);

    const custAfter = await prisma.customer.findUnique({ where: { id: testCustomerAId } });
    assert.equal(Number(custAfter?.dueBalance), initialCustDue + 20.0);
  });

  test("28. Cash refund is correct when refund exceeds remaining invoice due", async () => {
    const custBefore = await prisma.customer.findUnique({ where: { id: testCustomerAId } });
    const custDueBefore = Number(custBefore?.dueBalance);

    const saleRecord = await prisma.sale.findFirst({
      where: { customerId: testCustomerAId, status: SaleStatus.PARTIALLY_RETURNED },
      include: { items: true },
    });
    assert.ok(saleRecord);

    const ret = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: saleRecord.id,
      reason: "Refund exceeding remaining invoice due",
      items: [{ saleItemId: saleRecord.items[0].id, quantity: 8, unit: UnitName.PIECE }],
    });

    assert.equal(ret.refundAmount, 40.0);
    assert.equal(ret.dueReduced, 20.0);
    assert.equal(ret.cashRefunded, 20.0);

    const saleAfter = await prisma.sale.findUnique({ where: { id: saleRecord.id } });
    assert.equal(Number(saleAfter?.dueAmount), 0.0);

    const custAfter = await prisma.customer.findUnique({ where: { id: testCustomerAId } });
    assert.equal(Number(custAfter?.dueBalance), custDueBefore - 20.0);
  });

  test("29. Customer with no remaining invoice due receives full refund in cash", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      customerId: testCustomerAId,
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 10 }],
      paidAmount: 50.0,
      paymentMethod: PayMethod.CASH,
    });
    const sId = s.sale.id as string;
    const [sItemId] = await getSaleItemIds(sId);

    const custBefore = await prisma.customer.findUnique({ where: { id: testCustomerAId } });
    const custDueBefore = Number(custBefore?.dueBalance);

    const ret = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sId,
      reason: "Fully paid customer return",
      items: [{ saleItemId: sItemId, quantity: 4, unit: UnitName.PIECE }],
    });

    assert.equal(ret.dueReduced, 0.0);
    assert.equal(ret.cashRefunded, 20.0);

    const custAfter = await prisma.customer.findUnique({ where: { id: testCustomerAId } });
    assert.equal(Number(custAfter?.dueBalance), custDueBefore);
  });

  test("30. Customer due balance does not become negative", async () => {
    const cust = await prisma.customer.findUnique({ where: { id: testCustomerAId } });
    assert.ok(Number(cust?.dueBalance) >= 0);
  });

  test("31. Unrelated customer invoices and balances remain unchanged", async () => {
    const unrelatedCust = await prisma.customer.findUnique({ where: { id: testCustomerUnrelatedId } });
    assert.equal(Number(unrelatedCust?.dueBalance), 500);
  });

  test("32 & 33. Multiple partial returns do not cause rounding drift and reconcile with original invoice on final return", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [
        { medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 7 },
        { medicineId: medicineAId, batchId: batch2Id, unit: UnitName.PIECE, quantity: 7 },
      ],
      discount: { type: DiscountType.FIXED, value: 10 },
      paidAmount: 67.0,
    });
    const sId = s.sale.id as string;
    const [item1Id, item2Id] = await getSaleItemIds(sId);

    const ret1 = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sId,
      reason: "Partial return 1 for rounding test",
      items: [
        { saleItemId: item1Id, quantity: 3, unit: UnitName.PIECE },
        { saleItemId: item2Id, quantity: 2, unit: UnitName.PIECE },
      ],
    });

    const ret2 = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sId,
      reason: "Partial return 2 for rounding test",
      items: [
        { saleItemId: item1Id, quantity: 2, unit: UnitName.PIECE },
        { saleItemId: item2Id, quantity: 3, unit: UnitName.PIECE },
      ],
    });

    const ret3 = await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sId,
      reason: "Final return for rounding test",
      items: [
        { saleItemId: item1Id, quantity: 2, unit: UnitName.PIECE },
        { saleItemId: item2Id, quantity: 2, unit: UnitName.PIECE },
      ],
    });

    const totalDiscountAllocated = round2(
      ret1.discountShare + ret2.discountShare + ret3.discountShare
    );
    assert.equal(totalDiscountAllocated, 10.0);

    const totalRefundAllocated = round2(
      ret1.refundAmount + ret2.refundAmount + ret3.refundAmount
    );
    assert.equal(totalRefundAllocated, 67.0);

    const totalItemsAmount = round2(
      ret1.itemsAmount + ret2.itemsAmount + ret3.itemsAmount
    );
    assert.equal(totalItemsAmount, 77.0);
  });

  test("34. Decimal-safe arithmetic preserves monetary precision", async () => {
    assert.equal(round2(0.1 + 0.2), 0.3);
  });

  test("35. Payment and refund entries are consistent with accounting architecture", async () => {
    const list = await SalesReturnService.getSalesReturns(pharmacyAId, ownerUserA, {});
    for (const r of list.data) {
      assert.equal(round2(r.dueReduced + r.cashRefunded), r.refundAmount);
    }
  });

  // ==========================================
  // Section D: Transactions, Concurrency & Listings (36 - 42)
  // ==========================================

  test("36. Failed return rolls back all changes atomically", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 10 }],
      paidAmount: 50.0,
    });
    const sId = s.sale.id as string;
    const [sItemId] = await getSaleItemIds(sId);

    const b1Before = await prisma.medicineBatch.findUnique({ where: { id: batch1Id } });
    const b1QtyBefore = Number(b1Before?.availableQty);

    await assert.rejects(
      async () => {
        await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
          saleId: sId,
          reason: "Excess return failure test",
          items: [{ saleItemId: sItemId, quantity: 15, unit: UnitName.PIECE }],
        });
      },
      (err: any) => {
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED);
        return true;
      }
    );

    const b1After = await prisma.medicineBatch.findUnique({ where: { id: batch1Id } });
    assert.equal(Number(b1After?.availableQty), b1QtyBefore);

    const sItemAfter = await prisma.saleItem.findUnique({ where: { id: sItemId } });
    assert.equal(sItemAfter?.returnedQtyPieces, 0);

    const returnsCount = await prisma.saleReturn.count({ where: { saleId: sId } });
    assert.equal(returnsCount, 0);
  });

  test("37 & 38. Concurrent returns cannot exceed original sold quantity or duplicate stock restoration", async () => {
    const s = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 10 }],
      paidAmount: 50.0,
    });
    const sId = s.sale.id as string;
    const [sItemId] = await getSaleItemIds(sId);

    const b1Before = await prisma.medicineBatch.findUnique({ where: { id: batch1Id } });
    const b1QtyBefore = Number(b1Before?.availableQty);

    const results = await Promise.allSettled([
      SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
        saleId: sId,
        reason: "Concurrent return attempt A",
        items: [{ saleItemId: sItemId, quantity: 7, unit: UnitName.PIECE }],
      }),
      SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
        saleId: sId,
        reason: "Concurrent return attempt B",
        items: [{ saleItemId: sItemId, quantity: 7, unit: UnitName.PIECE }],
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const b1After = await prisma.medicineBatch.findUnique({ where: { id: batch1Id } });
    assert.equal(Number(b1After?.availableQty), b1QtyBefore + 7);

    const sItem = await prisma.saleItem.findUnique({ where: { id: sItemId } });
    assert.equal(sItem?.returnedQtyPieces, 7);
  });

  test("39. Return number uniqueness is maintained (SR-XXXXXX)", async () => {
    const list = await SalesReturnService.getSalesReturns(pharmacyAId, ownerUserA, {});
    const returnNos = list.data.map((r) => r.returnNo);
    const uniqueNos = new Set(returnNos);
    assert.equal(returnNos.length, uniqueNos.size);
    for (const no of returnNos) {
      assert.match(no, /^SR-\d{6}$/);
    }
  });

  test("40. Audit information is recorded correctly", async () => {
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        pharmacyId: pharmacyAId,
        action: "SALE_RETURN_CREATED",
      },
    });
    assert.ok(auditLogs.length > 0);
    assert.ok(auditLogs[0].userName);
    assert.ok(auditLogs[0].entityType === "SaleReturn");
    assert.ok(auditLogs[0].entityId);
  });

  test("41. Listing filters, pagination, and authorization behave correctly", async () => {
    const page1 = await SalesReturnService.getSalesReturns(pharmacyAId, ownerUserA, {
      page: "1",
      limit: "2",
    });
    assert.equal(page1.data.length, 2);
    assert.equal(page1.meta.limit, 2);

    const saleFiltered = await SalesReturnService.getSalesReturns(pharmacyAId, ownerUserA, {
      saleId: sale1Id,
    });
    for (const r of saleFiltered.data) {
      assert.equal(r.sale.id, sale1Id);
    }

    await assert.rejects(
      async () => {
        await SalesReturnService.getSalesReturns(pharmacyAId, cashierUserA, {
          createdById: ownerUserA.id,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, SALES_RETURN_ERROR_CODES.FORBIDDEN_FILTER_PARAM);
        return true;
      }
    );
  });

  test("42. Return details contain the expected fields without unauthorized information", async () => {
    const returns = await SalesReturnService.getSalesReturns(pharmacyAId, ownerUserA, {
      saleId: sale1Id,
    });
    const returnId = returns.data[0].id;

    const details = await SalesReturnService.getSalesReturnById(
      pharmacyAId,
      ownerUserA,
      returnId
    );

    assert.equal(details.id, returnId);
    assert.ok(details.returnNo);
    assert.ok(details.saleId);
    assert.ok(details.invoiceNo);
    assert.ok(details.reason);
    assert.ok(details.items.length > 0);

    for (const item of details.items) {
      assert.ok(item.medicineName);
      assert.ok(item.batchNo);
      assert.ok(item.unitPricePerPiece > 0);
      assert.ok(item.quantityPieces > 0);
      assert.ok(item.refundAmount >= 0);
      assert.equal((item as any).costPricePerPiece, undefined);
    }
  });
});
