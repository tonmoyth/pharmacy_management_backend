import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  PayMethod,
  PurchaseReturnReason,
  PurchaseStatus,
  Role,
  StockMovementType,
  UnitName,
} from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { PurchaseReturnService } from "./purchase_returns.service";
import { PurchaseService } from "../purchases/purchases.service";
import AppError from "../../../errors/AppError";
import { PURCHASE_RETURN_ERROR_CODES } from "./purchase_returns.constant";

describe("Purchase Returns Module Integration & Business Logic Tests", () => {
  const pharmacyIdA = "cmuznebub000hul3ko0ur8z55";
  const pharmacyIdB = "cmuzo3w1e0008ulvst4zz1gce";

  const ownerUser = {
    id: "cmuznec23000jul3k7vnwcl5p",
    name: "John Doe Owner",
    role: Role.PHARMACY_OWNER,
  };

  const staffUser = {
    id: "cmv3rf2u10001ulnc8guiori4",
    name: "Rahim Staff",
    role: Role.STAFF,
  };

  let testSupplierAId = "";
  let testSupplierBId = "";
  let testMedicineA1Id = "";
  let testMedicineA2Id = "";
  let testMedicineBId = "";

  let testPurchaseAId = "";
  let testPurchaseCancelledId = "";
  let testPurchaseItemA1Id = "";
  let testPurchaseItemA2Id = "";
  let testBatchA1Id = "";
  let testBatchA2Id = "";

  before(async () => {
    // 1. Setup Suppliers
    const supplierA = await prisma.supplier.create({
      data: {
        pharmacyId: pharmacyIdA,
        name: `TEST_PR_SUPL_A_${Date.now()}`,
        phone: "01799887766",
        company: "Beximco Dist PR",
        dueBalance: 5000,
        isActive: true,
      },
    });
    testSupplierAId = supplierA.id;

    const supplierB = await prisma.supplier.create({
      data: {
        pharmacyId: pharmacyIdB,
        name: `TEST_PR_SUPL_B_${Date.now()}`,
        phone: "01799887755",
        company: "Square Dist PR",
        dueBalance: 2000,
        isActive: true,
      },
    });
    testSupplierBId = supplierB.id;

    // 2. Setup Medicines in Pharmacy A
    // Medicine A1: BOX=100, STRIP=10, PIECE=1
    const medicineA1 = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyIdA,
        name: `TEST_PR_MED_A1_${Date.now()}`,
        genericName: "Paracetamol",
        strength: "500mg",
        dosageForm: "Tablet",
        status: "ACTIVE",
        createdById: ownerUser.id,
        units: {
          create: [
            { unit: UnitName.PIECE, piecesPerUnit: 1 },
            { unit: UnitName.STRIP, piecesPerUnit: 10 },
            { unit: UnitName.BOX, piecesPerUnit: 100 },
          ],
        },
      },
    });
    testMedicineA1Id = medicineA1.id;

    // Medicine A2: STRIP=10, PIECE=1
    const medicineA2 = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyIdA,
        name: `TEST_PR_MED_A2_${Date.now()}`,
        genericName: "Omeprazole",
        strength: "20mg",
        dosageForm: "Capsule",
        status: "ACTIVE",
        createdById: ownerUser.id,
        units: {
          create: [
            { unit: UnitName.PIECE, piecesPerUnit: 1 },
            { unit: UnitName.STRIP, piecesPerUnit: 10 },
          ],
        },
      },
    });
    testMedicineA2Id = medicineA2.id;

    // 3. Setup Medicine in Pharmacy B
    const medicineB = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyIdB,
        name: `TEST_PR_MED_B_${Date.now()}`,
        genericName: "Azithromycin",
        strength: "500mg",
        dosageForm: "Tablet",
        status: "ACTIVE",
        createdById: ownerUser.id,
        units: {
          create: [{ unit: UnitName.PIECE, piecesPerUnit: 1 }],
        },
      },
    });
    testMedicineBId = medicineB.id;

    // 4. Create an active Purchase in Pharmacy A with 2 items
    // Item 1: 5 Boxes (500 pieces) at 500 BDT/Box (5 BDT/piece), selling 600 BDT/Box
    // Item 2: 20 Strips (200 pieces) at 80 BDT/Strip (8 BDT/piece), selling 100 BDT/Strip
    const purchaseResult = await PurchaseService.createPurchase(
      pharmacyIdA,
      ownerUser,
      {
        supplierId: testSupplierAId,
        invoiceNo: `PR-INV-${Date.now()}`,
        purchaseDate: "2026-10-15",
        paidAmount: 1000,
        paymentMethod: PayMethod.CASH,
        note: "Initial test purchase for return module",
        items: [
          {
            medicineId: testMedicineA1Id,
            unit: UnitName.BOX,
            quantity: 5,
            batchNo: `BATCH-A1-${Date.now()}`,
            expiry: "12/2028",
            mrp: 700,
            purchasePrice: 500,
            sellingPrice: 600,
          },
          {
            medicineId: testMedicineA2Id,
            unit: UnitName.STRIP,
            quantity: 20,
            batchNo: `BATCH-A2-${Date.now()}`,
            expiry: "10/2028",
            mrp: 120,
            purchasePrice: 80,
            sellingPrice: 100,
          },
        ],
      }
    );

    testPurchaseAId = purchaseResult.purchase.id;
    testPurchaseItemA1Id = purchaseResult.purchase.items[0].id;
    testPurchaseItemA2Id = purchaseResult.purchase.items[1].id;
    testBatchA1Id = purchaseResult.purchase.items[0].batchId;
    testBatchA2Id = purchaseResult.purchase.items[1].batchId;

    // 5. Create a cancelled purchase to verify cancellation rule
    const cancelledPurchaseResult = await PurchaseService.createPurchase(
      pharmacyIdA,
      ownerUser,
      {
        supplierId: testSupplierAId,
        invoiceNo: `PR-CANCEL-INV-${Date.now()}`,
        purchaseDate: "2026-10-15",
        paidAmount: 0,
        items: [
          {
            medicineId: testMedicineA1Id,
            unit: UnitName.PIECE,
            quantity: 10,
            batchNo: `BATCH-CANCEL-${Date.now()}`,
            expiry: "08/2028",
            purchasePrice: 5,
            sellingPrice: 6,
          },
        ],
      }
    );
    testPurchaseCancelledId = cancelledPurchaseResult.purchase.id;

    // Cancel this purchase
    await PurchaseService.cancelPurchase(
      pharmacyIdA,
      testPurchaseCancelledId,
      ownerUser,
      { reason: "Order mistake" }
    );
  });

  after(async () => {
    // Cleanup test records
    await prisma.stockMovement.deleteMany({
      where: {
        medicine: {
          name: { startsWith: "TEST_PR_MED_" },
        },
      },
    });

    await prisma.purchaseReturnItem.deleteMany({
      where: {
        batch: {
          medicine: {
            name: { startsWith: "TEST_PR_MED_" },
          },
        },
      },
    });

    await prisma.purchaseReturn.deleteMany({
      where: {
        pharmacyId: { in: [pharmacyIdA, pharmacyIdB] },
        supplierId: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
      },
    });

    await prisma.supplierPayment.deleteMany({
      where: {
        supplierId: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
      },
    });

    await prisma.purchaseItem.deleteMany({
      where: {
        medicine: {
          name: { startsWith: "TEST_PR_MED_" },
        },
      },
    });

    await prisma.purchase.deleteMany({
      where: {
        id: { in: [testPurchaseAId, testPurchaseCancelledId].filter(Boolean) },
      },
    });

    await prisma.medicineBatch.deleteMany({
      where: {
        medicine: {
          name: { startsWith: "TEST_PR_MED_" },
        },
      },
    });

    await prisma.medicineUnit.deleteMany({
      where: {
        medicine: {
          name: { startsWith: "TEST_PR_MED_" },
        },
      },
    });

    await prisma.medicine.deleteMany({
      where: {
        id: {
          in: [
            testMedicineA1Id,
            testMedicineA2Id,
            testMedicineBId,
          ].filter(Boolean),
        },
      },
    });

    await prisma.supplier.deleteMany({
      where: {
        id: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
      },
    });

    try {
      const { redis } = await import("../../../config/redis");
      redis.disconnect();
    } catch (_) {}
  });

  test("1. Validation: Invalid purchase, cancelled purchase, unrelated items, invalid units & duplicates rejected", async () => {
    // 1.1 Non-existent purchase rejected
    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: "non-existent-id",
            reason: PurchaseReturnReason.DAMAGED,
            items: [
              {
                purchaseItemId: testPurchaseItemA1Id,
                quantity: 1,
                unit: UnitName.BOX,
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /purchase not found/i);
        return true;
      }
    );

    // 1.2 Cross-tenant purchase rejected (Pharmacy B trying to return Pharmacy A's purchase)
    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdB,
          staffUser,
          {
            purchaseId: testPurchaseAId,
            reason: PurchaseReturnReason.DAMAGED,
            items: [
              {
                purchaseItemId: testPurchaseItemA1Id,
                quantity: 1,
                unit: UnitName.BOX,
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    // 1.3 Cancelled purchase rejected
    await assert.rejects(
      async () => {
        const cancelledPurchase = await prisma.purchase.findUnique({
          where: { id: testPurchaseCancelledId },
          include: { items: true },
        });

        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: testPurchaseCancelledId,
            reason: PurchaseReturnReason.EXPIRED,
            items: [
              {
                purchaseItemId: cancelledPurchase!.items[0].id,
                quantity: 1,
                unit: UnitName.PIECE,
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /cancelled purchase/i);
        return true;
      }
    );

    // 1.4 Unrelated purchase item rejected
    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: testPurchaseAId,
            reason: PurchaseReturnReason.WRONG_ITEM,
            items: [
              {
                purchaseItemId: "unrelated-item-id",
                quantity: 1,
                unit: UnitName.BOX,
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /does not belong to purchase/i);
        return true;
      }
    );

    // 1.5 Invalid unit (Medicine A2 only has PIECE and STRIP, not BOX)
    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: testPurchaseAId,
            reason: PurchaseReturnReason.OTHER,
            items: [
              {
                purchaseItemId: testPurchaseItemA2Id,
                quantity: 1,
                unit: UnitName.BOX, // BOX is NOT configured on Medicine A2
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /not configured for medicine/i);
        return true;
      }
    );

    // 1.6 Duplicate purchaseItemId in same request rejected
    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: testPurchaseAId,
            reason: PurchaseReturnReason.DAMAGED,
            items: [
              {
                purchaseItemId: testPurchaseItemA1Id,
                quantity: 1,
                unit: UnitName.BOX,
              },
              {
                purchaseItemId: testPurchaseItemA1Id,
                quantity: 2,
                unit: UnitName.STRIP,
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /duplicate purchase item entry/i);
        return true;
      }
    );
  });

  test("2. Validation: RETURN_QTY_EXCEEDED when exceeding batch stock or purchased quantity", async () => {
    // 2.1 Requesting more than originally purchased quantity (purchased 5 boxes = 500 pcs; requesting 6 boxes = 600 pcs)
    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: testPurchaseAId,
            reason: PurchaseReturnReason.WRONG_ITEM,
            items: [
              {
                purchaseItemId: testPurchaseItemA1Id,
                quantity: 6, // 6 boxes = 600 pieces > 500 pieces
                unit: UnitName.BOX,
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED);
        assert.match(err.message, /exceeds remaining returnable quantity/i);
        return true;
      }
    );

    // 2.2 Artificially reduce batch availableQty below requested quantity to test Condition 1
    const originalBatch = await prisma.medicineBatch.findUnique({
      where: { id: testBatchA1Id },
    });
    assert(originalBatch);

    await prisma.medicineBatch.update({
      where: { id: testBatchA1Id },
      data: { availableQty: 50 }, // only 50 pieces available now
    });

    // Attempting to return 1 Box (100 pieces) when only 50 pieces are available
    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: testPurchaseAId,
            reason: PurchaseReturnReason.EXPIRED,
            items: [
              {
                purchaseItemId: testPurchaseItemA1Id,
                quantity: 1, // 1 box = 100 pieces > 50 available
                unit: UnitName.BOX,
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED);
        assert.match(err.message, /exceeds available stock/i);
        return true;
      }
    );

    // Restore batch availableQty
    await prisma.medicineBatch.update({
      where: { id: testBatchA1Id },
      data: { availableQty: originalBatch.availableQty },
    });
  });

  let createdReturn1Id = "";
  let createdReturn1No = "";

  test("3. Successful Purchase Return: inventory reduction, stock movement, valuation, counter & supplier due credit", async () => {
    // Initial state
    const batchBefore = await prisma.medicineBatch.findUnique({
      where: { id: testBatchA1Id },
    });
    const supplierBefore = await prisma.supplier.findUnique({
      where: { id: testSupplierAId },
    });
    const purchaseBefore = await prisma.purchase.findUnique({
      where: { id: testPurchaseAId },
    });

    assert(batchBefore);
    assert(supplierBefore);
    assert(purchaseBefore);

    const initialBatchQty = batchBefore.availableQty; // 500
    const initialSupplierDue = Number(supplierBefore.dueBalance);

    // Return 2 Boxes of Item 1 (2 * 100 = 200 pieces)
    // Original price: 500 BDT per box (5 BDT per piece)
    // Expected return amount: 200 pcs * 5 BDT = 1000 BDT
    const returnResult = await PurchaseReturnService.createPurchaseReturn(
      pharmacyIdA,
      staffUser,
      {
        purchaseId: testPurchaseAId,
        reason: PurchaseReturnReason.DAMAGED,
        note: "Damaged during delivery",
        items: [
          {
            purchaseItemId: testPurchaseItemA1Id,
            quantity: 2,
            unit: UnitName.BOX,
          },
        ],
      },
      "127.0.0.1",
      "Mozilla/5.0 TestRunner"
    );

    createdReturn1Id = returnResult.id;
    createdReturn1No = returnResult.returnNo;

    // 3.1 Header assertions
    assert.ok(returnResult.id);
    assert.match(returnResult.returnNo, /^PR-\d{6}$/);
    assert.equal(returnResult.reason, PurchaseReturnReason.DAMAGED);
    assert.equal(returnResult.note, "Damaged during delivery");
    assert.equal(returnResult.totalAmount, 1000);
    assert.equal(returnResult.pharmacyId, pharmacyIdA);

    // 3.2 Item assertions
    assert.equal(returnResult.items.length, 1);
    const item1 = returnResult.items[0];
    assert.equal(item1.quantityPieces, 200);
    assert.equal(item1.unitPricePerPiece, 5);
    assert.equal(item1.lineTotal, 1000);

    // 3.3 Batch availableQty decreased by 200 pieces
    const batchAfter = await prisma.medicineBatch.findUnique({
      where: { id: testBatchA1Id },
    });
    assert(batchAfter);
    assert.equal(batchAfter.availableQty, initialBatchQty - 200);

    // 3.4 StockMovement created with PURCHASE_RETURN and -200 pieces
    const stockMovement = await prisma.stockMovement.findFirst({
      where: {
        pharmacyId: pharmacyIdA,
        batchId: testBatchA1Id,
        type: StockMovementType.PURCHASE_RETURN,
        refId: returnResult.id,
      },
    });
    assert(stockMovement);
    assert.equal(stockMovement.quantityPieces, -200);
    assert.equal(stockMovement.balanceAfter, batchAfter.availableQty);
    assert.equal(stockMovement.refType, "PurchaseReturn");
    assert.equal(stockMovement.createdById, staffUser.id);

    // 3.5 PurchaseItem.returnedQtyPieces updated
    const pItemAfter = await prisma.purchaseItem.findUnique({
      where: { id: testPurchaseItemA1Id },
    });
    assert(pItemAfter);
    assert.equal(pItemAfter.returnedQtyPieces, 200);

    // 3.6 Supplier dueBalance decreased by return amount (1000 BDT)
    const supplierAfter = await prisma.supplier.findUnique({
      where: { id: testSupplierAId },
    });
    assert(supplierAfter);
    assert.equal(
      Number(supplierAfter.dueBalance),
      initialSupplierDue - 1000
    );

    // 3.7 Historical purchase record remains unchanged
    const purchaseAfter = await prisma.purchase.findUnique({
      where: { id: testPurchaseAId },
    });
    assert(purchaseAfter);
    assert.equal(
      Number(purchaseAfter.totalAmount),
      Number(purchaseBefore.totalAmount)
    );
    assert.equal(
      Number(purchaseAfter.paidAmount),
      Number(purchaseBefore.paidAmount)
    );
    assert.equal(
      Number(purchaseAfter.dueAmount),
      Number(purchaseBefore.dueAmount)
    );

    // 3.8 AuditLog created
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        pharmacyId: pharmacyIdA,
        action: "PURCHASE_RETURN_CREATED",
        entityId: returnResult.id,
      },
    });
    assert(auditLog);
    assert.equal(auditLog.entityType, "PurchaseReturn");
    assert.equal(auditLog.userId, staffUser.id);
  });

  test("4. Accounting for previous returns & negative supplier due representing credit", async () => {
    // We already returned 2 boxes (200 pieces) of Item 1 out of 5 boxes (500 pieces).
    // Remaining returnable pieces = 300 pieces (3 boxes or 30 strips).

    // 4.1 Attempting to return 4 boxes (400 pieces) should fail with RETURN_QTY_EXCEEDED
    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: testPurchaseAId,
            reason: PurchaseReturnReason.WRONG_ITEM,
            items: [
              {
                purchaseItemId: testPurchaseItemA1Id,
                quantity: 4, // 400 pieces > 300 remaining
                unit: UnitName.BOX,
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.code, PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED);
        assert.match(err.message, /exceeds remaining returnable quantity/i);
        return true;
      }
    );

    // 4.2 Return exactly 2 more boxes (200 pieces) using a different reason: EXPIRED
    const return2Result = await PurchaseReturnService.createPurchaseReturn(
      pharmacyIdA,
      ownerUser,
      {
        purchaseId: testPurchaseAId,
        reason: PurchaseReturnReason.EXPIRED,
        note: "Expired batch found on shelf",
        items: [
          {
            purchaseItemId: testPurchaseItemA1Id,
            quantity: 2, // 200 pieces (total returned becomes 400)
            unit: UnitName.BOX,
          },
        ],
      }
    );

    assert.ok(return2Result.id);
    assert.equal(return2Result.reason, PurchaseReturnReason.EXPIRED);
    // ReturnNo must have incremented
    assert.notEqual(return2Result.returnNo, createdReturn1No);

    // Check PurchaseItem cumulative returned quantity
    const pItemAfter2 = await prisma.purchaseItem.findUnique({
      where: { id: testPurchaseItemA1Id },
    });
    assert.equal(pItemAfter2?.returnedQtyPieces, 400);

    // 4.3 Now test negative supplier due balance representing supplier credit
    // Let's set supplier dueBalance to a low value (e.g. 500 BDT)
    await prisma.supplier.update({
      where: { id: testSupplierAId },
      data: { dueBalance: 500 },
    });

    // Return 1 box of Item 1 (100 pieces * 5 BDT = 500 BDT) + 10 strips of Item 2 (100 pieces * 8 BDT = 800 BDT)
    // Total return amount: 500 + 800 = 1300 BDT
    // New supplier due balance should be: 500 - 1300 = -800 BDT (supplier credit)
    const return3Result = await PurchaseReturnService.createPurchaseReturn(
      pharmacyIdA,
      ownerUser,
      {
        purchaseId: testPurchaseAId,
        reason: PurchaseReturnReason.WRONG_ITEM,
        note: "Final multi-item return causing supplier credit",
        items: [
          {
            purchaseItemId: testPurchaseItemA1Id,
            quantity: 1, // 1 box (remaining 100 pieces returned)
            unit: UnitName.BOX,
          },
          {
            purchaseItemId: testPurchaseItemA2Id,
            quantity: 10, // 10 strips (100 pieces out of 200)
            unit: UnitName.STRIP,
          },
        ],
      }
    );

    assert.equal(return3Result.totalAmount, 1300);
    assert.equal(return3Result.items.length, 2);

    const supplierAfter3 = await prisma.supplier.findUnique({
      where: { id: testSupplierAId },
    });
    assert(supplierAfter3);
    // Negative balance allowed: -800
    assert.equal(Number(supplierAfter3.dueBalance), -800);

    // Total returnable for Item 1 is now fully exhausted (500/500).
    // Attempting to return even 1 piece of Item 1 must fail.
    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: testPurchaseAId,
            reason: PurchaseReturnReason.OTHER,
            items: [
              {
                purchaseItemId: testPurchaseItemA1Id,
                quantity: 1,
                unit: UnitName.PIECE,
              },
            ],
          }
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.code, PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED);
        return true;
      }
    );
  });

  test("5. GET /purchase-returns and GET /purchase-returns/:id", async () => {
    // 5.1 List purchase returns for Pharmacy A
    const listResultA = await PurchaseReturnService.getPurchaseReturns(
      pharmacyIdA,
      { page: "1", limit: "10" }
    );

    assert.ok(listResultA.meta);
    assert.ok(listResultA.data.length >= 3);
    assert.equal(listResultA.meta.page, 1);
    assert.equal(listResultA.meta.limit, 10);

    // Verify ordering: newest returns first
    const dates = listResultA.data.map((d: any) =>
      new Date(d.createdAt).getTime()
    );
    for (let i = 0; i < dates.length - 1; i++) {
      assert(dates[i] >= dates[i + 1]);
    }

    // 5.2 Filter by supplierId
    const filteredBySupplier = await PurchaseReturnService.getPurchaseReturns(
      pharmacyIdA,
      { supplierId: testSupplierAId }
    );
    for (const item of filteredBySupplier.data) {
      assert.equal(item.supplier.id, testSupplierAId);
    }

    // 5.3 Filter by purchaseId
    const filteredByPurchase = await PurchaseReturnService.getPurchaseReturns(
      pharmacyIdA,
      { purchaseId: testPurchaseAId }
    );
    for (const item of filteredByPurchase.data) {
      assert.equal(item.purchase.id, testPurchaseAId);
    }

    // 5.4 Date range filter
    const today = new Date().toISOString().split("T")[0];
    const filteredByDate = await PurchaseReturnService.getPurchaseReturns(
      pharmacyIdA,
      { dateFrom: today, dateTo: today }
    );
    assert(filteredByDate.data.length >= 3);

    // 5.5 Tenant Isolation on list: Pharmacy B sees 0 returns
    const listResultB = await PurchaseReturnService.getPurchaseReturns(
      pharmacyIdB,
      {}
    );
    assert.equal(listResultB.data.length, 0);

    // 5.6 GET by ID details
    const returnDetails = await PurchaseReturnService.getPurchaseReturnById(
      pharmacyIdA,
      createdReturn1Id
    );

    assert.equal(returnDetails.id, createdReturn1Id);
    assert.equal(returnDetails.returnNo, createdReturn1No);
    assert.equal(returnDetails.reason, PurchaseReturnReason.DAMAGED);
    assert.equal(returnDetails.totalAmount, 1000);
    assert.ok(returnDetails.supplier);
    assert.ok(returnDetails.purchase);
    assert.ok(returnDetails.createdBy);
    assert.equal(returnDetails.items.length, 1);

    const detailItem = returnDetails.items[0];
    assert.equal(detailItem.quantityPieces, 200);
    assert.equal(detailItem.enteredUnit, UnitName.BOX);
    assert.equal(detailItem.quantityInEnteredUnit, 2);
    assert.equal(detailItem.unitPricePerPiece, 5);
    assert.equal(detailItem.lineTotal, 1000);
    assert.ok(detailItem.batch);
    assert.ok(detailItem.medicine);
    assert.equal(detailItem.medicine?.name.startsWith("TEST_PR_MED_"), true);

    // 5.7 Cross-tenant ID access rejected
    await assert.rejects(
      async () => {
        await PurchaseReturnService.getPurchaseReturnById(
          pharmacyIdB,
          createdReturn1Id
        );
      },
      (err: any) => {
        assert(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /purchase return not found/i);
        return true;
      }
    );
  });

  test("6. Transaction Rollback & Concurrency Safety", async () => {
    // 6.1 Transaction Rollback:
    // If a request has one valid item and one invalid item (exceeding stock),
    // the entire transaction rolls back and no partial records or balance updates exist.
    const supplierBeforeRollback = await prisma.supplier.findUnique({
      where: { id: testSupplierAId },
    });
    const batchBeforeRollback = await prisma.medicineBatch.findUnique({
      where: { id: testBatchA2Id },
    });
    const countBeforeRollback = await prisma.purchaseReturn.count({
      where: { pharmacyId: pharmacyIdA },
    });

    await assert.rejects(
      async () => {
        await PurchaseReturnService.createPurchaseReturn(
          pharmacyIdA,
          staffUser,
          {
            purchaseId: testPurchaseAId,
            reason: PurchaseReturnReason.OTHER,
            items: [
              {
                purchaseItemId: testPurchaseItemA2Id,
                quantity: 1, // valid: 1 strip = 10 pcs
                unit: UnitName.STRIP,
              },
              {
                purchaseItemId: testPurchaseItemA1Id,
                quantity: 10, // invalid: Item 1 is already exhausted
                unit: UnitName.BOX,
              },
            ],
          }
        );
      }
    );

    // Verify nothing changed in database
    const countAfterRollback = await prisma.purchaseReturn.count({
      where: { pharmacyId: pharmacyIdA },
    });
    assert.equal(countAfterRollback, countBeforeRollback);

    const supplierAfterRollback = await prisma.supplier.findUnique({
      where: { id: testSupplierAId },
    });
    assert.equal(
      Number(supplierAfterRollback?.dueBalance),
      Number(supplierBeforeRollback?.dueBalance)
    );

    const batchAfterRollback = await prisma.medicineBatch.findUnique({
      where: { id: testBatchA2Id },
    });
    assert.equal(
      batchAfterRollback?.availableQty,
      batchBeforeRollback?.availableQty
    );

    // 6.2 Concurrency safety:
    // Item 2 currently has 10 strips (100 pieces) remaining to be returned out of 20 strips.
    // If two requests simultaneously attempt to return 7 strips (70 pieces each, total 140 pieces > 100 remaining),
    // one MUST succeed and the other MUST fail with RETURN_QTY_EXCEEDED.
    const concurrent1 = PurchaseReturnService.createPurchaseReturn(
      pharmacyIdA,
      ownerUser,
      {
        purchaseId: testPurchaseAId,
        reason: PurchaseReturnReason.DAMAGED,
        items: [
          {
            purchaseItemId: testPurchaseItemA2Id,
            quantity: 7, // 70 pieces
            unit: UnitName.STRIP,
          },
        ],
      }
    );

    const concurrent2 = PurchaseReturnService.createPurchaseReturn(
      pharmacyIdA,
      staffUser,
      {
        purchaseId: testPurchaseAId,
        reason: PurchaseReturnReason.DAMAGED,
        items: [
          {
            purchaseItemId: testPurchaseItemA2Id,
            quantity: 7, // 70 pieces
            unit: UnitName.STRIP,
          },
        ],
      }
    );

    const results = await Promise.allSettled([concurrent1, concurrent2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "Exactly one concurrent return must succeed");
    assert.equal(rejected.length, 1, "Exactly one concurrent return must fail");

    const failedReason: any = (rejected[0] as PromiseRejectedResult).reason;
    assert.equal(
      failedReason.code,
      PURCHASE_RETURN_ERROR_CODES.RETURN_QTY_EXCEEDED
    );

    // Verify batch availableQty is never negative
    const finalBatchA2 = await prisma.medicineBatch.findUnique({
      where: { id: testBatchA2Id },
    });
    assert(finalBatchA2);
    assert(finalBatchA2.availableQty >= 0, "Batch stock must never become negative");
  });
});
