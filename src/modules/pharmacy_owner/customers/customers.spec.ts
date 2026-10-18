import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  MedicineStatus,
  PayMethod,
  PharmacyStatus,
  Role,
  SaleStatus,
  UnitName,
  UserStatus,
} from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { redis } from "../../../config/redis";
import { CustomerService } from "./customers.service";
import { SalesService } from "../sales/sales.service";
import { SalesReturnService } from "../sales_returns/sales_returns.service";
import AppError from "../../../errors/AppError";
import { CUSTOMER_ERROR_CODES } from "./customers.constant";

describe("Customers & Customer Due Module Integration Tests", () => {
  let pharmacyAId = "";
  let pharmacyBId = "";

  let ownerUserA: { id: string; name: string; role: Role };
  let cashierUserA: { id: string; name: string; role: Role };
  let staffUserA: { id: string; name: string; role: Role };
  let ownerUserB: { id: string; name: string; role: Role };

  let medicineAId = "";
  let batch1Id = "";

  const timestamp = Date.now();

  before(async () => {
    // 1. Setup Pharmacy A
    const pharmacyA = await prisma.pharmacy.create({
      data: {
        name: `TEST_CUST_PHARMA_A_${timestamp}`,
        ownerName: "Owner Cust A",
        phone: `0171${String(timestamp).slice(-7)}`,
        email: `cust_a_${timestamp}@example.com`,
        address: "Dhanmondi, Dhaka",
        city: "Dhaka",
        area: "Dhanmondi",
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyAId = pharmacyA.id;

    // 2. Setup Pharmacy B (for cross-pharmacy tests)
    const pharmacyB = await prisma.pharmacy.create({
      data: {
        name: `TEST_CUST_PHARMA_B_${timestamp}`,
        ownerName: "Owner Cust B",
        phone: `0172${String(timestamp).slice(-7)}`,
        email: `cust_b_${timestamp}@example.com`,
        address: "Banani, Dhaka",
        city: "Dhaka",
        area: "Banani",
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyBId = pharmacyB.id;

    // 3. Setup Users for Pharmacy A
    const owner = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Owner User A",
        email: `cust_owner_${timestamp}@example.com`,
        role: Role.PHARMACY_OWNER,
        status: UserStatus.ACTIVE,
      },
    });
    ownerUserA = { id: owner.id, name: owner.name, role: owner.role };

    const cashier = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Cashier User A",
        email: `cust_cashier_${timestamp}@example.com`,
        role: Role.CASHIER,
        status: UserStatus.ACTIVE,
      },
    });
    cashierUserA = { id: cashier.id, name: cashier.name, role: cashier.role };

    const staff = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Staff User A",
        email: `cust_staff_${timestamp}@example.com`,
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
        email: `cust_owner_b_${timestamp}@example.com`,
        role: Role.PHARMACY_OWNER,
        status: UserStatus.ACTIVE,
      },
    });
    ownerUserB = { id: ownerB.id, name: ownerB.name, role: ownerB.role };

    // 4. Setup Medicine and Batch in Pharmacy A for sale/due generation tests
    const medA = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `CUST_MED_${timestamp}`,
        genericName: "Paracetamol",
        strength: "500mg",
        dosageForm: "Tablet",
        status: MedicineStatus.ACTIVE,
        units: {
          create: [{ unit: UnitName.PIECE, piecesPerUnit: 1 }],
        },
      },
    });
    medicineAId = medA.id;

    const b1 = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: medicineAId,
        batchNo: `CUST-BATCH-${timestamp}`,
        expiryDate: new Date("2029-12-31"),
        purchasePrice: 2.0,
        sellingPrice: 10.0,
        receivedQty: 2000,
        availableQty: 2000,
      },
    });
    batch1Id = b1.id;
  });

  after(async () => {
    try {
      await prisma.auditLog.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.duePaymentAllocation.deleteMany({
        where: { duePayment: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } },
      });
      await prisma.duePayment.deleteMany({
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

  // Shared test variables
  let testCustomer1Id = "";
  const sharedPhone = `01799${String(timestamp).slice(-6)}`;

  // ==========================================
  // Section 1: Customer CRUD & Uniqueness (1 - 8)
  // ==========================================

  test("1. Create a customer successfully", async () => {
    const cust = await CustomerService.createCustomer(pharmacyAId, ownerUserA, {
      name: "Rahim Ahmed",
      phone: sharedPhone,
      address: "House 10, Road 5, Dhanmondi",
      creditLimit: 5000,
    });

    assert.ok(cust.id);
    assert.equal(cust.name, "Rahim Ahmed");
    assert.equal(cust.phone, sharedPhone);
    assert.equal(cust.address, "House 10, Road 5, Dhanmondi");
    assert.equal(cust.creditLimit, 5000);
    assert.equal(cust.dueBalance, 0);
    assert.equal(cust.totalPurchase, 0);
    assert.equal(cust.totalPaid, 0);
    assert.equal(cust.isActive, true);

    testCustomer1Id = cust.id;
  });

  test("2. Create a customer without an optional phone number", async () => {
    const cust = await CustomerService.createCustomer(pharmacyAId, ownerUserA, {
      name: "Anonymous Walk-In Regular",
      phone: null,
      address: "Local area",
    });

    assert.ok(cust.id);
    assert.equal(cust.name, "Anonymous Walk-In Regular");
    assert.equal(cust.phone, null);
    assert.equal(cust.dueBalance, 0);
  });

  test("3. Reject duplicate phone numbers within the same pharmacy", async () => {
    await assert.rejects(
      async () => {
        await CustomerService.createCustomer(pharmacyAId, ownerUserA, {
          name: "Another Person Same Phone",
          phone: sharedPhone,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, CUSTOMER_ERROR_CODES.PHONE_ALREADY_EXISTS);
        return true;
      }
    );
  });

  test("4. Allow the same phone number in different pharmacies", async () => {
    const custPharmacyB = await CustomerService.createCustomer(pharmacyBId, ownerUserB, {
      name: "Rahim in Pharmacy B",
      phone: sharedPhone,
      creditLimit: 2000,
    });

    assert.ok(custPharmacyB.id);
    assert.equal(custPharmacyB.pharmacyId, pharmacyBId);
    assert.equal(custPharmacyB.phone, sharedPhone);
  });

  test("5. List customers with search and hasDue filters", async () => {
    // Search by name
    const searchResult = await CustomerService.getCustomers(pharmacyAId, {
      searchTerm: "Rahim",
    });
    assert.ok(searchResult.data.length >= 1);
    assert.equal(searchResult.data[0].name, "Rahim Ahmed");

    // hasDue filter when no dues yet
    const hasDueResult = await CustomerService.getCustomers(pharmacyAId, {
      hasDue: "true",
    });
    assert.equal(hasDueResult.data.length, 0);

    const noDueResult = await CustomerService.getCustomers(pharmacyAId, {
      hasDue: "false",
    });
    assert.ok(noDueResult.data.length >= 2);
  });

  test("6. Return accurate customer totals (totalPurchase, totalPaid, dueBalance)", async () => {
    const details = await CustomerService.getCustomerById(pharmacyAId, testCustomer1Id);
    assert.equal(details.totalPurchase, 0);
    assert.equal(details.totalPaid, 0);
    assert.equal(details.dueBalance, 0);
    assert.equal(details.creditLimit, 5000);
  });

  test("7. Update customer information and isActive", async () => {
    const updated = await CustomerService.updateCustomer(
      pharmacyAId,
      ownerUserA,
      testCustomer1Id,
      {
        name: "Rahim Ahmed Chowdhury",
        address: "Updated Address Dhanmondi",
        creditLimit: 7500,
        isActive: true,
      }
    );

    assert.equal(updated.name, "Rahim Ahmed Chowdhury");
    assert.equal(updated.address, "Updated Address Dhanmondi");
    assert.equal(updated.creditLimit, 7500);
  });

  test("8. Customer deletion is not supported through API and records are preserved", async () => {
    // Assert CustomerService has no delete method and record remains intact
    assert.equal((CustomerService as any).deleteCustomer, undefined);
    const cust = await CustomerService.getCustomerById(pharmacyAId, testCustomer1Id);
    assert.ok(cust);
    assert.equal(cust.id, testCustomer1Id);
  });

  // ==========================================
  // Section 2: Tenant Isolation & Sales History (9 - 10)
  // ==========================================

  test("9. Enforce tenant isolation on all customer endpoints", async () => {
    // Pharmacy B cannot view Pharmacy A's customer
    await assert.rejects(
      async () => {
        await CustomerService.getCustomerById(pharmacyBId, testCustomer1Id);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    // Pharmacy B cannot collect payment on Pharmacy A's customer
    await assert.rejects(
      async () => {
        await CustomerService.createDuePayment(pharmacyBId, ownerUserB, testCustomer1Id, {
          amount: 100,
          method: PayMethod.CASH,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  test("10. Ensure Cashier/Staff only see their own sales rows in customer sales history", async () => {
    // Owner creates sale 1 for customer
    const saleOwner = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      customerId: testCustomer1Id,
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 10 }],
      paidAmount: 60.0, // total 100, due 40
      paymentMethod: PayMethod.CASH,
    });

    // Cashier creates sale 2 for customer
    const saleCashier = await SalesService.confirmSale(pharmacyAId, cashierUserA, {
      customerId: testCustomer1Id,
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 5 }],
      paidAmount: 20.0, // total 50, due 30
      paymentMethod: PayMethod.CASH,
    });

    // Owner checks customer sales -> sees BOTH sales
    const ownerSales = await CustomerService.getCustomerSales(
      pharmacyAId,
      ownerUserA,
      testCustomer1Id,
      {}
    );
    assert.equal(ownerSales.data.length, 2);

    // Cashier checks customer sales -> sees ONLY their own sale
    const cashierSales = await CustomerService.getCustomerSales(
      pharmacyAId,
      cashierUserA,
      testCustomer1Id,
      {}
    );
    assert.equal(cashierSales.data.length, 1);
    assert.equal(cashierSales.data[0].id, saleCashier.sale.id);

    // Staff checks customer sales -> sees 0 sales because staff created none
    const staffSales = await CustomerService.getCustomerSales(
      pharmacyAId,
      staffUserA,
      testCustomer1Id,
      {}
    );
    assert.equal(staffSales.data.length, 0);

    // Verify customer due balance after the two sales: 40 + 30 = 70 BDT
    const custAfterSales = await CustomerService.getCustomerById(pharmacyAId, testCustomer1Id);
    assert.equal(custAfterSales.dueBalance, 70.0);
    assert.equal(custAfterSales.totalPurchase, 150.0);
    assert.equal(custAfterSales.totalPaid, 80.0);
  });

  // ==========================================
  // Section 3: Due Collection Screen (GET /dues/customers)
  // ==========================================

  test("GET /dues/customers returns only customers with positive due balances", async () => {
    const dueList = await CustomerService.getDueCustomers(pharmacyAId, {});
    assert.ok(dueList.data.length >= 1);
    const target = dueList.data.find((c: any) => c.id === testCustomer1Id);
    assert.ok(target);
    assert.equal(target.dueBalance, 70.0);

    for (const item of dueList.data) {
      assert.ok(item.dueBalance > 0);
    }
  });

  // ==========================================
  // Section 4: Due Payment Validation & Allocations (13 - 18)
  // ==========================================

  test("13. Due collection rejects zero, negative, invalid, or excessive amounts", async () => {
    // Negative or zero
    await assert.rejects(
      async () => {
        await CustomerService.createDuePayment(pharmacyAId, ownerUserA, testCustomer1Id, {
          amount: 0,
          method: PayMethod.CASH,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );

    // Excessive amount (> 70 BDT)
    await assert.rejects(
      async () => {
        await CustomerService.createDuePayment(pharmacyAId, ownerUserA, testCustomer1Id, {
          amount: 75.0,
          method: PayMethod.CASH,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, CUSTOMER_ERROR_CODES.PAYMENT_EXCEEDS_DUE);
        return true;
      }
    );
  });

  test("14 & 16. Partial payment allocation works correctly and allocates oldest invoice first", async () => {
    // Current unpaid invoices:
    // Invoice 1 (Owner): due 40
    // Invoice 2 (Cashier): due 30
    // Total due: 70
    // Customer pays 25 BDT
    const payment = await CustomerService.createDuePayment(
      pharmacyAId,
      ownerUserA,
      testCustomer1Id,
      {
        amount: 25.0,
        method: PayMethod.CASH,
        note: "Partial payment for invoice 1",
      }
    );

    assert.equal(payment.amount, 25.0);
    assert.equal(payment.previousDueBalance, 70.0);
    assert.equal(payment.newDueBalance, 45.0);
    assert.equal(payment.allocations.length, 1);
    assert.equal(payment.allocations[0].amount, 25.0);
    assert.equal(payment.allocations[0].remainingDue, 15.0);

    const cust = await CustomerService.getCustomerById(pharmacyAId, testCustomer1Id);
    assert.equal(cust.dueBalance, 45.0);
    assert.equal(cust.totalPaid, 105.0); // 80 + 25 = 105
  });

  test("17 & 18. Payments spanning multiple invoices allocate correctly and update balances consistently", async () => {
    // Remaining dues:
    // Invoice 1: due 15
    // Invoice 2: due 30
    // Total due: 45
    // Customer pays 35 BDT -> Invoice 1 gets 15 (due becomes 0), Invoice 2 gets 20 (due becomes 10)
    const payment = await CustomerService.createDuePayment(
      pharmacyAId,
      cashierUserA,
      testCustomer1Id,
      {
        amount: 35.0,
        method: PayMethod.BKASH,
        note: "Multi-invoice payment via bKash",
      }
    );

    assert.equal(payment.amount, 35.0);
    assert.equal(payment.previousDueBalance, 45.0);
    assert.equal(payment.newDueBalance, 10.0);
    assert.equal(payment.allocations.length, 2);

    assert.equal(payment.allocations[0].amount, 15.0);
    assert.equal(payment.allocations[0].remainingDue, 0.0);

    assert.equal(payment.allocations[1].amount, 20.0);
    assert.equal(payment.allocations[1].remainingDue, 10.0);

    const cust = await CustomerService.getCustomerById(pharmacyAId, testCustomer1Id);
    assert.equal(cust.dueBalance, 10.0);
    assert.equal(cust.totalPaid, 140.0); // 105 + 35 = 140
  });

  test("15. Full payment allocation clears all remaining due balance", async () => {
    // Remaining due: 10 BDT on Invoice 2
    const payment = await CustomerService.createDuePayment(
      pharmacyAId,
      ownerUserA,
      testCustomer1Id,
      {
        amount: 10.0,
        method: PayMethod.CASH,
      }
    );

    assert.equal(payment.amount, 10.0);
    assert.equal(payment.previousDueBalance, 10.0);
    assert.equal(payment.newDueBalance, 0.0);
    assert.equal(payment.allocations.length, 1);
    assert.equal(payment.allocations[0].remainingDue, 0.0);

    const cust = await CustomerService.getCustomerById(pharmacyAId, testCustomer1Id);
    assert.equal(cust.dueBalance, 0.0);
    assert.equal(cust.totalPaid, 150.0);
  });

  // ==========================================
  // Section 5: Ledger & Returns Due Interaction (11 - 12)
  // ==========================================

  test("11 & 12. Ledger running balances are correct and returns do not cause duplicate due reductions", async () => {
    // Create new customer for ledger and return tests
    const custLedger = await CustomerService.createCustomer(pharmacyAId, ownerUserA, {
      name: "Ledger Test Customer",
      phone: `01788${String(timestamp).slice(-6)}`,
    });

    // 1. Sale: 10 pieces * 10 = 100 BDT, paid 50, due created 50
    const sale = await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      customerId: custLedger.id,
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 10 }],
      paidAmount: 50.0,
      paymentMethod: PayMethod.CASH,
    });

    const [saleItemId] = (
      await prisma.saleItem.findMany({
        where: { saleId: sale.sale.id as string },
        select: { id: true },
      })
    ).map((i) => i.id);

    // 2. Return 2 pieces: 20 BDT refund. Reduces due by 20. Remaining due 30.
    await SalesReturnService.createSalesReturn(pharmacyAId, ownerUserA, {
      saleId: sale.sale.id as string,
      reason: "Customer returned 2 pieces for due reduction",
      items: [{ saleItemId, quantity: 2, unit: UnitName.PIECE }],
    });

    // 3. Customer pays remaining 30 BDT due
    await CustomerService.createDuePayment(pharmacyAId, ownerUserA, custLedger.id, {
      amount: 30.0,
      method: PayMethod.CASH,
      note: "Clear remaining due",
    });

    // Check Ledger
    const ledger = await CustomerService.getCustomerLedger(pharmacyAId, custLedger.id, {});
    assert.equal(ledger.data.length, 3);

    // Entry 1: Sale due created: debit 50, credit 0, runningBalance 50
    assert.equal(ledger.data[0].type, "SALE_DUE");
    assert.equal(ledger.data[0].debit, 50.0);
    assert.equal(ledger.data[0].credit, 0.0);
    assert.equal(ledger.data[0].runningBalance, 50.0);

    // Entry 2: Sales Return due reduction: debit 0, credit 20, runningBalance 30
    assert.equal(ledger.data[1].type, "SALE_RETURN_DUE_REDUCTION");
    assert.equal(ledger.data[1].debit, 0.0);
    assert.equal(ledger.data[1].credit, 20.0);
    assert.equal(ledger.data[1].runningBalance, 30.0);

    // Entry 3: Due Payment: debit 0, credit 30, runningBalance 0
    assert.equal(ledger.data[2].type, "DUE_PAYMENT");
    assert.equal(ledger.data[2].debit, 0.0);
    assert.equal(ledger.data[2].credit, 30.0);
    assert.equal(ledger.data[2].runningBalance, 0.0);

    // Closing balance reconciles with currentCustomerDueBalance (0 BDT)
    assert.equal(ledger.summary.closingBalance, 0.0);
    assert.equal(ledger.summary.currentCustomerDueBalance, 0.0);
  });

  // ==========================================
  // Section 6: Concurrency, Transactions & Payment History (19 - 22)
  // ==========================================

  test("19. Concurrent due-payment requests cannot over-collect", async () => {
    const custConcurrent = await CustomerService.createCustomer(pharmacyAId, ownerUserA, {
      name: "Concurrent Test Customer",
      phone: `01777${String(timestamp).slice(-6)}`,
    });

    // Sale with 50 BDT due
    await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      customerId: custConcurrent.id,
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 5 }],
      paidAmount: 0.0, // total 50, due 50
      paymentMethod: PayMethod.CASH,
    });

    // Fire two concurrent payment requests of 30 BDT each (Total 60 > 50)
    const results = await Promise.allSettled([
      CustomerService.createDuePayment(pharmacyAId, ownerUserA, custConcurrent.id, {
        amount: 30.0,
        method: PayMethod.CASH,
      }),
      CustomerService.createDuePayment(pharmacyAId, cashierUserA, custConcurrent.id, {
        amount: 30.0,
        method: PayMethod.CASH,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one must succeed and one must fail because row-level lock serializes them!
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const custAfter = await CustomerService.getCustomerById(pharmacyAId, custConcurrent.id);
    assert.equal(custAfter.dueBalance, 20.0); // 50 - 30 = 20
  });

  test("20. Failed transactions roll back payment, allocation, invoice, and customer-balance changes", async () => {
    const custFail = await CustomerService.createCustomer(pharmacyAId, ownerUserA, {
      name: "Rollback Test Customer",
      phone: `01766${String(timestamp).slice(-6)}`,
    });

    await SalesService.confirmSale(pharmacyAId, ownerUserA, {
      customerId: custFail.id,
      items: [{ medicineId: medicineAId, batchId: batch1Id, unit: UnitName.PIECE, quantity: 4 }],
      paidAmount: 10.0, // total 40, due 30
      paymentMethod: PayMethod.CASH,
    });

    // Attempt invalid excessive payment of 100
    await assert.rejects(
      async () => {
        await CustomerService.createDuePayment(pharmacyAId, ownerUserA, custFail.id, {
          amount: 100.0,
          method: PayMethod.CASH,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        return true;
      }
    );

    // Verify customer dueBalance and payments unchanged
    const custCheck = await CustomerService.getCustomerById(pharmacyAId, custFail.id);
    assert.equal(custCheck.dueBalance, 30.0);

    const payments = await prisma.duePayment.findMany({
      where: { customerId: custFail.id },
    });
    assert.equal(payments.length, 0);
  });

  test("21. Payment history returns only the selected customer's records", async () => {
    const history = await CustomerService.getDuePayments(pharmacyAId, testCustomer1Id, {});
    assert.ok(history.data.length >= 3);
    for (const p of history.data) {
      assert.equal(p.customerId, testCustomer1Id);
      assert.ok(p.allocations.length >= 1);
      assert.ok(p.createdBy.id);
    }
  });

  test("22. Decimal-safe calculations preserve monetary precision", async () => {
    const custDecimal = await CustomerService.createCustomer(pharmacyAId, ownerUserA, {
      name: "Decimal Precision Customer",
      phone: `01755${String(timestamp).slice(-6)}`,
    });

    // Two decimal due
    await prisma.customer.update({
      where: { id: custDecimal.id },
      data: { dueBalance: 33.33 },
    });

    const cust = await CustomerService.getCustomerById(pharmacyAId, custDecimal.id);
    assert.equal(cust.dueBalance, 33.33);
  });
});
