import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PayMethod, PurchaseStatus, Role } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { SupplierService } from "./suppliers.service";
import AppError from "../../../errors/AppError";

describe("Suppliers and Supplier Due Module Tests", () => {
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
  let testPurchaseAId = "";

  before(async () => {
    // Cleanup any existing test suppliers
    await prisma.supplierPayment.deleteMany({
      where: {
        supplier: {
          name: { startsWith: "TEST_SUPL_" },
        },
      },
    });
    await prisma.purchaseReturn.deleteMany({
      where: {
        supplier: {
          name: { startsWith: "TEST_SUPL_" },
        },
      },
    });
    await prisma.purchase.deleteMany({
      where: {
        supplier: {
          name: { startsWith: "TEST_SUPL_" },
        },
      },
    });
    await prisma.supplier.deleteMany({
      where: {
        name: { startsWith: "TEST_SUPL_" },
      },
    });
  });

  after(async () => {
    // Clean up created test data
    if (testSupplierAId || testSupplierBId) {
      await prisma.supplierPayment.deleteMany({
        where: {
          supplierId: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
        },
      });
      await prisma.purchaseReturn.deleteMany({
        where: {
          supplierId: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
        },
      });
      await prisma.purchase.deleteMany({
        where: {
          supplierId: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
        },
      });
      await prisma.supplier.deleteMany({
        where: {
          id: { in: [testSupplierAId, testSupplierBId].filter(Boolean) },
        },
      });
    }
  });

  test("1. Supplier creation by authorized roles (Owner & Staff)", async () => {
    // Owner creates supplier A
    const createdByOwner = await SupplierService.createSupplier(
      pharmacyIdA,
      ownerUser,
      {
        name: "TEST_SUPL_Square Pharma",
        phone: "01711000001",
        company: "Square Pharmaceuticals",
        address: "Dhaka, Bangladesh",
      }
    );

    assert.ok(createdByOwner.id);
    assert.equal(createdByOwner.name, "TEST_SUPL_Square Pharma");
    assert.equal(createdByOwner.dueBalance, 0);
    testSupplierAId = createdByOwner.id;

    // Staff creates supplier B in Pharmacy B
    const createdByStaff = await SupplierService.createSupplier(
      pharmacyIdB,
      staffUser,
      {
        name: "TEST_SUPL_Beximco Pharma",
        phone: "01711000002",
        company: "Beximco Ltd",
        address: "Gazipur, Bangladesh",
      }
    );

    assert.ok(createdByStaff.id);
    assert.equal(createdByStaff.name, "TEST_SUPL_Beximco Pharma");
    // Staff response MUST NOT contain dueBalance
    assert.equal(
      (createdByStaff as any).dueBalance,
      undefined,
      "Staff response must not expose dueBalance"
    );
    testSupplierBId = createdByStaff.id;
  });

  test("2. Owner and STAFF supplier list responses with RBAC data filtering", async () => {
    // Owner list response in Pharmacy A
    const ownerList = await SupplierService.getSuppliers(
      pharmacyIdA,
      Role.PHARMACY_OWNER,
      { search: "TEST_SUPL_" }
    );

    assert.ok(ownerList.data.length > 0);
    const ownerItem = ownerList.data.find((s) => s.id === testSupplierAId);
    assert.ok(ownerItem);
    assert.ok("dueBalance" in ownerItem, "Owner list must contain dueBalance");
    assert.equal(typeof ownerItem.dueBalance, "number");

    // Staff list response in Pharmacy A
    const staffList = await SupplierService.getSuppliers(
      pharmacyIdA,
      Role.STAFF,
      { search: "TEST_SUPL_" }
    );

    assert.ok(staffList.data.length > 0);
    const staffItem = staffList.data.find((s) => s.id === testSupplierAId);
    assert.ok(staffItem);
    assert.equal(
      (staffItem as any).dueBalance,
      undefined,
      "Staff list must NEVER expose dueBalance"
    );
    assert.ok("name" in staffItem);
    assert.ok("phone" in staffItem);
    assert.ok("company" in staffItem);
  });

  test("3. Cross-tenant supplier access is rejected (404)", async () => {
    // Pharmacy B trying to view Pharmacy A's supplier
    await assert.rejects(
      async () => {
        await SupplierService.getSupplierById(pharmacyIdB, testSupplierAId);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /Supplier not found/);
        return true;
      }
    );

    // Pharmacy B trying to update Pharmacy A's supplier
    await assert.rejects(
      async () => {
        await SupplierService.updateSupplier(
          pharmacyIdB,
          testSupplierAId,
          ownerUser,
          { name: "Hacked Supplier" }
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  test("4. Supplier updates and active status changes by Owner", async () => {
    const updated = await SupplierService.updateSupplier(
      pharmacyIdA,
      testSupplierAId,
      ownerUser,
      {
        phone: "01799999999",
        company: "Square Health Ltd",
        isActive: false,
      }
    );

    assert.equal(updated.phone, "01799999999");
    assert.equal(updated.company, "Square Health Ltd");
    assert.equal(updated.isActive, false);

    // Reactivate for further tests
    await SupplierService.updateSupplier(
      pharmacyIdA,
      testSupplierAId,
      ownerUser,
      { isActive: true }
    );
  });

  test("5. Payment validation: 0, negative amounts, and PAYMENT_EXCEEDS_DUE on zero due", async () => {
    // 0 amount rejected
    await assert.rejects(
      async () => {
        await SupplierService.recordSupplierPayment(
          pharmacyIdA,
          testSupplierAId,
          ownerUser,
          { amount: 0, method: PayMethod.CASH }
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    // Payment exceeding due (currently dueBalance is 0)
    await assert.rejects(
      async () => {
        await SupplierService.recordSupplierPayment(
          pharmacyIdA,
          testSupplierAId,
          ownerUser,
          { amount: 500, method: PayMethod.CASH }
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, "PAYMENT_EXCEEDS_DUE");
        return true;
      }
    );
  });

  test("6. Purchase creation, supplier balance calculation, and payment validation", async () => {
    // Create a purchase of 10,000 BDT for Supplier A
    const purchase = await prisma.purchase.create({
      data: {
        pharmacyId: pharmacyIdA,
        supplierId: testSupplierAId,
        invoiceNo: `INV-TEST-${Date.now()}`,
        purchaseDate: new Date(),
        totalAmount: 10000,
        paidAmount: 0,
        dueAmount: 10000,
        status: PurchaseStatus.COMPLETED,
        createdById: ownerUser.id,
      },
    });
    testPurchaseAId = purchase.id;

    // View supplier details: totalPurchase should be 10000, totalPaid 0, dueBalance 10000
    const details = await SupplierService.getSupplierById(
      pharmacyIdA,
      testSupplierAId
    );
    assert.equal(details.totalPurchase, 10000);
    assert.equal(details.totalPaid, 0);
    assert.equal(details.dueBalance, 10000);

    // Cross-supplier purchase link rejection:
    // Try to record payment on Supplier B using Supplier A's purchaseId
    // First, give Supplier B some due
    const purchaseB = await prisma.purchase.create({
      data: {
        pharmacyId: pharmacyIdB,
        supplierId: testSupplierBId,
        invoiceNo: `INV-B-${Date.now()}`,
        purchaseDate: new Date(),
        totalAmount: 5000,
        paidAmount: 0,
        dueAmount: 5000,
        status: PurchaseStatus.COMPLETED,
        createdById: ownerUser.id,
      },
    });

    await assert.rejects(
      async () => {
        await SupplierService.recordSupplierPayment(
          pharmacyIdB,
          testSupplierBId,
          ownerUser,
          {
            amount: 1000,
            method: PayMethod.BANK,
            purchaseId: testPurchaseAId, // belongs to supplier A, not B!
          }
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Purchase not found/);
        return true;
      }
    );

    // Clean up temporary purchaseB
    await prisma.purchase.delete({ where: { id: purchaseB.id } });
  });

  test("7. Successful payment updates correct accounting records & prevents overpayment", async () => {
    // Record payment of 4,000 BDT against testPurchaseAId
    const paymentResult = await SupplierService.recordSupplierPayment(
      pharmacyIdA,
      testSupplierAId,
      ownerUser,
      {
        amount: 4000,
        method: PayMethod.BANK,
        note: "Partial payment for invoice",
        purchaseId: testPurchaseAId,
      }
    );

    assert.equal(paymentResult.payment.amount, 4000);
    assert.equal(paymentResult.financialSummary.dueBalance, 6000);
    assert.equal(paymentResult.financialSummary.totalPaid, 4000);

    // Verify purchase in DB has updated paidAmount and dueAmount
    const updatedPurchase = await prisma.purchase.findUnique({
      where: { id: testPurchaseAId },
    });
    assert.equal(Number(updatedPurchase?.paidAmount), 4000);
    assert.equal(Number(updatedPurchase?.dueAmount), 6000);

    // Verify supplier in DB has updated dueBalance
    const updatedSupplier = await prisma.supplier.findUnique({
      where: { id: testSupplierAId },
    });
    assert.equal(Number(updatedSupplier?.dueBalance), 6000);

    // Attempt to pay 7000 (exceeds remaining 6000) -> PAYMENT_EXCEEDS_DUE
    await assert.rejects(
      async () => {
        await SupplierService.recordSupplierPayment(
          pharmacyIdA,
          testSupplierAId,
          ownerUser,
          {
            amount: 7000,
            method: PayMethod.CASH,
          }
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, "PAYMENT_EXCEEDS_DUE");
        return true;
      }
    );
  });

  test("8. Purchase return affects due balance and reconciles in ledger", async () => {
    // Add a Purchase Return of 1,000 BDT for damaged goods
    await prisma.purchaseReturn.create({
      data: {
        pharmacyId: pharmacyIdA,
        supplierId: testSupplierAId,
        purchaseId: testPurchaseAId,
        returnNo: `RET-${Date.now()}`,
        reason: "DAMAGED",
        note: "Damaged syrup bottles returned",
        totalAmount: 1000,
        createdById: ownerUser.id,
      },
    });

    // Check supplier details:
    // Total Purchase: 10,000
    // Total Return: 1,000
    // Total Paid: 4,000
    // Net Due: 10000 - 1000 - 4000 = 5,000 BDT
    const details = await SupplierService.getSupplierById(
      pharmacyIdA,
      testSupplierAId
    );
    assert.equal(details.totalPurchase, 10000);
    assert.equal(details.totalReturn, 1000);
    assert.equal(details.totalPaid, 4000);
    assert.equal(details.dueBalance, 5000);

    // Check ledger:
    const ledger = await SupplierService.getSupplierLedger(
      pharmacyIdA,
      testSupplierAId,
      { page: 1, limit: 10 }
    );

    assert.equal(ledger.summary.totalPurchase, 10000);
    assert.equal(ledger.summary.totalReturn, 1000);
    assert.equal(ledger.summary.totalPaid, 4000);
    assert.equal(ledger.summary.closingBalance, 5000);
    assert.equal(
      ledger.summary.closingBalance,
      details.dueBalance,
      "Ledger closing balance must reconcile with supplier dueBalance"
    );

    // Verify chronological order and running balances
    // Entry 1: Purchase (Credit 10000, Debit 0, RunningBalance 10000)
    // Entry 2: Return or Payment
    assert.equal(ledger.data.length, 3);
    const purchaseEntry = ledger.data.find((e) => e.type === "PURCHASE");
    assert.ok(purchaseEntry);
    assert.equal(purchaseEntry.credit, 10000);
    assert.equal(purchaseEntry.debit, 0);

    const lastEntry = ledger.data[ledger.data.length - 1];
    assert.equal(lastEntry.runningBalance, 5000);
  });

  test("9. Payment history and hasDue filtering", async () => {
    // Payment history pagination
    const payments = await SupplierService.getSupplierPayments(
      pharmacyIdA,
      testSupplierAId,
      { page: 1, limit: 5 }
    );

    assert.equal(payments.meta.total, 1);
    assert.equal(payments.data[0].amount, 4000);
    assert.equal(payments.data[0].method, PayMethod.BANK);

    // hasDue=true filter
    const suppliersWithDue = await SupplierService.getSuppliers(
      pharmacyIdA,
      Role.PHARMACY_OWNER,
      { hasDue: "true" }
    );
    const foundWithDue = suppliersWithDue.data.find((s) => s.id === testSupplierAId);
    assert.ok(foundWithDue, "Supplier with 5000 due should be in hasDue=true list");

    // hasDue=false filter
    const suppliersWithoutDue = await SupplierService.getSuppliers(
      pharmacyIdA,
      Role.PHARMACY_OWNER,
      { hasDue: "false" }
    );
    const foundWithoutDue = suppliersWithoutDue.data.find(
      (s) => s.id === testSupplierAId
    );
    assert.equal(
      foundWithoutDue,
      undefined,
      "Supplier with 5000 due should NOT be in hasDue=false list"
    );
  });
});
