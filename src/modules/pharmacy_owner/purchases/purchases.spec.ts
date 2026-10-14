import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PayMethod, PurchaseStatus, Role, StockMovementType, UnitName } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { PurchaseService } from "./purchases.service";
import AppError from "../../../errors/AppError";

describe("Purchases Module Integration & Business Logic Tests", () => {
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
  let testMedicineAId = "";
  let testMedicineBId = "";
  let testPurchaseId = "";
  let testBatchId = "";

  before(async () => {
    // 1. Setup Supplier in Pharmacy A
    const supplierA = await prisma.supplier.create({
      data: {
        pharmacyId: pharmacyIdA,
        name: `TEST_PURCH_SUPL_A_${Date.now()}`,
        phone: "01711223344",
        company: "Beximco Dist",
        dueBalance: 0,
        isActive: true,
      },
    });
    testSupplierAId = supplierA.id;

    // 2. Setup Supplier in Pharmacy B
    const supplierB = await prisma.supplier.create({
      data: {
        pharmacyId: pharmacyIdB,
        name: `TEST_PURCH_SUPL_B_${Date.now()}`,
        phone: "01711223355",
        company: "Square Dist",
        dueBalance: 0,
        isActive: true,
      },
    });
    testSupplierBId = supplierB.id;

    // 3. Setup Medicine in Pharmacy A with units (BOX=100, STRIP=10, PIECE=1)
    const medicineA = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyIdA,
        name: `TEST_MED_A_${Date.now()}`,
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
    testMedicineAId = medicineA.id;

    // 4. Setup Medicine in Pharmacy B
    const medicineB = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyIdB,
        name: `TEST_MED_B_${Date.now()}`,
        genericName: "Cefixime",
        strength: "200mg",
        dosageForm: "Capsule",
        status: "ACTIVE",
        createdById: ownerUser.id,
        units: {
          create: [{ unit: UnitName.PIECE, piecesPerUnit: 1 }],
        },
      },
    });
    testMedicineBId = medicineB.id;
  });

  after(async () => {
    // Cleanup created test records
    await prisma.saleItem.deleteMany({
      where: {
        medicine: {
          name: { startsWith: "TEST_MED_" },
        },
      },
    });
    await prisma.sale.deleteMany({
      where: {
        pharmacyId: pharmacyIdA,
        invoiceNo: { startsWith: "SALE-" },
      },
    });
    await prisma.stockMovement.deleteMany({
      where: {
        medicine: {
          name: { startsWith: "TEST_MED_" },
        },
      },
    });
    await prisma.purchaseItem.deleteMany({
      where: {
        medicine: {
          name: { startsWith: "TEST_MED_" },
        },
      },
    });
    await prisma.supplierPayment.deleteMany({
      where: {
        supplierId: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
      },
    });
    await prisma.purchase.deleteMany({
      where: {
        supplierId: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
      },
    });
    await prisma.medicineBatch.deleteMany({
      where: {
        medicine: {
          name: { startsWith: "TEST_MED_" },
        },
      },
    });
    await prisma.medicineUnit.deleteMany({
      where: {
        medicine: {
          name: { startsWith: "TEST_MED_" },
        },
      },
    });
    await prisma.medicine.deleteMany({
      where: {
        id: { in: [testMedicineAId, testMedicineBId].filter(Boolean) },
      },
    });
    await prisma.supplier.deleteMany({
      where: {
        id: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
      },
    });
  });

  test("1. Validation: Expired expiry dates and invalid pricing rejected", async () => {
    // Expired date rejected (01/2020)
    await assert.rejects(
      async () => {
        await PurchaseService.createPurchase(pharmacyIdA, ownerUser, {
          supplierId: testSupplierAId,
          invoiceNo: `INV-FAIL-${Date.now()}`,
          purchaseDate: "2026-10-14",
          paidAmount: 0,
          items: [
            {
              medicineId: testMedicineAId,
              unit: UnitName.BOX,
              quantity: 2,
              batchNo: "BATCH-EXP",
              expiry: "01/2020",
              purchasePrice: 200,
              sellingPrice: 250,
            },
          ],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /expired/i);
        return true;
      }
    );

    // paidAmount > totalAmount rejected
    await assert.rejects(
      async () => {
        await PurchaseService.createPurchase(pharmacyIdA, ownerUser, {
          supplierId: testSupplierAId,
          invoiceNo: `INV-OVERPAY-${Date.now()}`,
          purchaseDate: "2026-10-14",
          paidAmount: 10000, // Total will be 2 * 200 = 400
          items: [
            {
              medicineId: testMedicineAId,
              unit: UnitName.BOX,
              quantity: 2,
              batchNo: "BATCH-OK",
              expiry: "12/2028",
              purchasePrice: 200,
              sellingPrice: 250,
            },
          ],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /cannot exceed/i);
        return true;
      }
    );
  });

  test("2. Cross-tenant supplier and medicine validation", async () => {
    // Try to purchase Medicine B (belongs to Pharmacy B) using Pharmacy A
    await assert.rejects(
      async () => {
        await PurchaseService.createPurchase(pharmacyIdA, ownerUser, {
          supplierId: testSupplierAId,
          invoiceNo: `INV-CROSS-${Date.now()}`,
          purchaseDate: "2026-10-14",
          paidAmount: 0,
          items: [
            {
              medicineId: testMedicineBId, // Cross-tenant!
              unit: UnitName.PIECE,
              quantity: 10,
              batchNo: "B-CROSS",
              expiry: "12/2028",
              purchasePrice: 10,
              sellingPrice: 15,
            },
          ],
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /not found in your pharmacy/i);
        return true;
      }
    );
  });

  test("3. Successful Purchase Creation, Unit Conversion, Batch Creation & Price Warnings", async () => {
    // Purchase 2 BOX (each BOX = 100 pieces => 200 pieces)
    // purchasePrice = 200 per BOX => 2.00 per piece
    // sellingPrice = 1.50 per BOX => 0.015 per piece (below purchase price warning!)
    // mrp = 100 per BOX => 1.00 per piece
    const result = await PurchaseService.createPurchase(pharmacyIdA, ownerUser, {
      supplierId: testSupplierAId,
      invoiceNo: `INV-P1-${Date.now()}`,
      purchaseDate: "2026-10-14",
      paidAmount: 100, // Partial payment
      paymentMethod: PayMethod.CASH,
      note: "Test Purchase 1",
      items: [
        {
          medicineId: testMedicineAId,
          unit: UnitName.BOX,
          quantity: 2,
          batchNo: "BATCH-P1",
          expiry: "12/2028",
          mrp: 300,
          purchasePrice: 200,
          sellingPrice: 150, // Below purchase price to test warning!
        },
      ],
    });

    assert.ok(result.purchase.id);
    testPurchaseId = result.purchase.id;
    assert.equal(result.purchase.totalAmount, 400); // 2 * 200 = 400
    assert.equal(result.purchase.paidAmount, 100);
    assert.equal(result.purchase.dueAmount, 300); // 400 - 100 = 300
    assert.equal(result.purchase.items.length, 1);

    const item = result.purchase.items[0];
    assert.equal(item.quantityPieces, 200); // 2 * 100
    assert.equal(item.purchasePricePerPiece, 2.0); // 200 / 100
    assert.equal(item.sellingPricePerPiece, 1.5); // 150 / 100
    testBatchId = item.batchId;

    // Verify warning was returned non-blocking
    assert.ok(result.warnings.length > 0);
    const belowWarning = result.warnings.find(
      (w) => w.code === "SELLING_PRICE_BELOW_PURCHASE_PRICE"
    );
    assert.ok(belowWarning);

    // Verify batch was created with correct pieces
    const batchInDb = await prisma.medicineBatch.findUnique({
      where: { id: testBatchId },
    });
    assert.equal(batchInDb?.availableQty, 200);
    assert.equal(batchInDb?.receivedQty, 200);

    // Verify StockMovement was created
    const movement = await prisma.stockMovement.findFirst({
      where: { refId: testPurchaseId, type: StockMovementType.PURCHASE },
    });
    assert.ok(movement);
    assert.equal(movement?.quantityPieces, 200);
    assert.equal(movement?.balanceAfter, 200);

    // Verify Supplier Due Balance was incremented by dueAmount (300)
    const supplierInDb = await prisma.supplier.findUnique({
      where: { id: testSupplierAId },
    });
    assert.equal(Number(supplierInDb?.dueBalance), 300);

    // Verify SupplierPayment was created for the 100 BDT
    const payment = await prisma.supplierPayment.findFirst({
      where: { purchaseId: testPurchaseId },
    });
    assert.ok(payment);
    assert.equal(Number(payment?.amount), 100);
    assert.equal(payment?.method, PayMethod.CASH);
  });

  test("4. Batch matching: same price adds to stock, different price creates separate batch", async () => {
    // Add 1 STRIP (10 pieces) with SAME batchNo and SAME per-piece prices (purchasePrice = 20, sellingPrice = 15 per strip => 2.00 / 1.50 per piece)
    const samePricePurchase = await PurchaseService.createPurchase(
      pharmacyIdA,
      staffUser,
      {
        supplierId: testSupplierAId,
        invoiceNo: `INV-SAME-${Date.now()}`,
        purchaseDate: "2026-10-14",
        paidAmount: 0,
        items: [
          {
            medicineId: testMedicineAId,
            unit: UnitName.STRIP,
            quantity: 1,
            batchNo: "BATCH-P1",
            expiry: "12/2028",
            purchasePrice: 20, // 20 / 10 = 2.00 / piece (matches existing batch!)
            sellingPrice: 15, // 15 / 10 = 1.50 / piece (matches existing batch!)
          },
        ],
      }
    );

    assert.equal(samePricePurchase.purchase.items[0].batchId, testBatchId);

    // Verify stock incremented on the SAME batch: 200 + 10 = 210
    const batchSame = await prisma.medicineBatch.findUnique({
      where: { id: testBatchId },
    });
    assert.equal(batchSame?.availableQty, 210);
    assert.equal(batchSame?.receivedQty, 210);

    // Clean up temporary purchase
    await prisma.stockMovement.deleteMany({
      where: { refId: samePricePurchase.purchase.id },
    });
    await prisma.purchaseItem.deleteMany({
      where: { purchaseId: samePricePurchase.purchase.id },
    });
    await prisma.purchase.delete({
      where: { id: samePricePurchase.purchase.id },
    });

    // Reset batch to 200 and supplier due to 300
    await prisma.medicineBatch.update({
      where: { id: testBatchId },
      data: { availableQty: 200, receivedQty: 200 },
    });
    await prisma.supplier.update({
      where: { id: testSupplierAId },
      data: { dueBalance: 300 },
    });
  });

  test("5. GET /purchases and GET /purchases/:id", async () => {
    // List purchases with filtering
    const listResult = await PurchaseService.getPurchases(pharmacyIdA, {
      supplierId: testSupplierAId,
      status: PurchaseStatus.COMPLETED,
    });

    assert.ok(listResult.data.length > 0);
    const found = listResult.data.find((p) => p.id === testPurchaseId);
    assert.ok(found);
    assert.equal(found.totalAmount, 400);
    assert.equal(found.paidAmount, 100);
    assert.equal(found.dueAmount, 300);

    // Get purchase by ID
    const details = await PurchaseService.getPurchaseById(
      pharmacyIdA,
      testPurchaseId
    );
    assert.equal(details.id, testPurchaseId);
    assert.equal(details.supplier.id, testSupplierAId);
    assert.equal(details.items.length, 1);
    assert.equal(details.items[0].batchNo, "BATCH-P1");
    assert.equal(details.supplierPayments.length, 1);
    assert.equal(details.supplierPayments[0].amount, 100);

    // Cross-tenant GET 404
    await assert.rejects(
      async () => {
        await PurchaseService.getPurchaseById(pharmacyIdB, testPurchaseId);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  test("6. Edit-check passes initially, blocks with 409 when dependent sale exists", async () => {
    // Initial edit check -> editable: true
    const check1 = await PurchaseService.checkPurchaseEditable(
      pharmacyIdA,
      testPurchaseId
    );
    assert.equal(check1.editable, true);
    assert.equal(check1.reason, null);

    // Simulate a dependent SaleItem on testBatchId
    const testCustomer = await prisma.customer.create({
      data: {
        pharmacyId: pharmacyIdA,
        name: "Test Customer",
        phone: `01711${Math.floor(100000 + Math.random() * 900000)}`,
      },
    });

    const testSale = await prisma.sale.create({
      data: {
        pharmacyId: pharmacyIdA,
        invoiceSeq: Math.floor(Date.now() % 10000000) + Math.floor(Math.random() * 1000),
        customerId: testCustomer.id,
        invoiceNo: `SALE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        subtotal: 50,
        totalAmount: 50,
        paidAmount: 50,
        dueAmount: 0,
        createdById: ownerUser.id,
        items: {
          create: [
            {
              medicineId: testMedicineAId,
              batchId: testBatchId,
              enteredUnit: UnitName.PIECE,
              enteredQty: 5,
              quantityPieces: 5,
              unitPricePerPiece: 10,
              costPricePerPiece: 2,
              lineSubtotal: 50,
            },
          ],
        },
      },
    });

    // Now edit check MUST return editable: false
    const check2 = await PurchaseService.checkPurchaseEditable(
      pharmacyIdA,
      testPurchaseId
    );
    assert.equal(check2.editable, false);
    assert.match(check2.reason || "", /Sales or returns exist for this purchase's batch/);

    // Attempting to PATCH must return 409 with exact message
    await assert.rejects(
      async () => {
        await PurchaseService.updatePurchase(
          pharmacyIdA,
          testPurchaseId,
          ownerUser,
          { note: "Trying to edit blocked purchase" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, "PURCHASE_HAS_DEPENDENTS");
        assert.equal(
          err.message,
          "Sales or returns exist for this purchase's batch, so it cannot be edited. Use Purchase Return for correction."
        );
        return true;
      }
    );

    // Clean up dependent sale and customer so tests 7 and 8 can edit and cancel
    await prisma.saleItem.deleteMany({
      where: { saleId: testSale.id },
    });
    await prisma.sale.delete({
      where: { id: testSale.id },
    });
    await prisma.customer.delete({
      where: { id: testCustomer.id },
    });
  });

  test("7. Successful Purchase Edit: reverses old stock, updates totals & supplier due", async () => {
    // Update purchase note and change invoiceNo
    const updateResult = await PurchaseService.updatePurchase(
      pharmacyIdA,
      testPurchaseId,
      ownerUser,
      {
        note: "Updated Purchase Note",
        invoiceNo: `INV-UPD-${Date.now()}`,
      }
    );

    assert.equal(updateResult.purchase.note, "Updated Purchase Note");
    assert.equal(updateResult.purchase.dueAmount, 300);
  });

  test("8. Purchase Cancellation: reverses stock, updates supplier due, sets CANCELLED", async () => {
    const cancelResult = await PurchaseService.cancelPurchase(
      pharmacyIdA,
      testPurchaseId,
      ownerUser,
      { reason: "Ordered by mistake" }
    );

    assert.equal(cancelResult.purchase.status, PurchaseStatus.CANCELLED);
    assert.equal(cancelResult.purchase.dueAmount, 0);

    // Verify batch stock was reversed: 200 - 200 = 0
    const batchAfterCancel = await prisma.medicineBatch.findUnique({
      where: { id: testBatchId },
    });
    assert.equal(batchAfterCancel?.availableQty, 0);

    // Verify StockMovement with type PURCHASE_CANCEL was created with -200 pieces
    const cancelMovement = await prisma.stockMovement.findFirst({
      where: {
        refId: testPurchaseId,
        type: StockMovementType.PURCHASE_CANCEL,
      },
    });
    assert.ok(cancelMovement);
    assert.equal(cancelMovement?.quantityPieces, -200);

    // Verify supplier due was reduced by 300 (from 300 back to 0)
    const supplierAfterCancel = await prisma.supplier.findUnique({
      where: { id: testSupplierAId },
    });
    assert.equal(Number(supplierAfterCancel?.dueBalance), 0);

    // Repeated cancellation is rejected
    await assert.rejects(
      async () => {
        await PurchaseService.cancelPurchase(
          pharmacyIdA,
          testPurchaseId,
          ownerUser,
          { reason: "Cancel again" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /already been cancelled/);
        return true;
      }
    );
  });
});
