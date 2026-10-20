import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  DiscountType,
  ExpenseCategory,
  MedicineStatus,
  PayMethod,
  PharmacyStatus,
  PurchaseReturnReason,
  PurchaseStatus,
  Role,
  SaleStatus,
  StockMovementType,
  UnitName,
  UserStatus,
} from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { redis } from "../../../config/redis";
import { DashboardService } from "./dashboard.service";
import { getDhakaBoundaries } from "./dashboard.helper";
import AppError from "../../../errors/AppError";

describe("Dashboard Module Integration & Business Logic Tests", () => {
  let pharmacyAId = "";
  let pharmacyBId = "";

  let ownerUserA: { id: string; name: string; role: Role; pharmacyId: string };
  let cashierUserA: { id: string; name: string; role: Role; pharmacyId: string };
  let staffUserA: { id: string; name: string; role: Role; pharmacyId: string };
  let ownerUserB: { id: string; name: string; role: Role; pharmacyId: string };

  const timestamp = Date.now();
  const boundaries = getDhakaBoundaries();

  before(async () => {
    // 1. Setup Pharmacy A
    const pharmacyA = await prisma.pharmacy.create({
      data: {
        name: `TEST_DASH_PHARMA_A_${timestamp}`,
        ownerName: "Owner Dash A",
        phone: `0171${String(timestamp).slice(-7)}`,
        email: `dash_a_${timestamp}@example.com`,
        address: "Banani, Dhaka",
        city: "Dhaka",
        area: "Banani",
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyAId = pharmacyA.id;

    // 2. Setup Pharmacy B (for cross-tenant checks)
    const pharmacyB = await prisma.pharmacy.create({
      data: {
        name: `TEST_DASH_PHARMA_B_${timestamp}`,
        ownerName: "Owner Dash B",
        phone: `0172${String(timestamp).slice(-7)}`,
        email: `dash_b_${timestamp}@example.com`,
        address: "Dhanmondi, Dhaka",
        city: "Dhaka",
        area: "Dhanmondi",
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyBId = pharmacyB.id;

    // 3. Setup Users for Pharmacy A
    const ownerA = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Owner User A",
        email: `dash_owner_a_${timestamp}@example.com`,
        role: Role.PHARMACY_OWNER,
        status: UserStatus.ACTIVE,
      },
    });
    ownerUserA = { id: ownerA.id, name: ownerA.name, role: ownerA.role, pharmacyId: pharmacyAId };

    const cashierA = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Cashier User A",
        email: `dash_cashier_a_${timestamp}@example.com`,
        role: Role.CASHIER,
        status: UserStatus.ACTIVE,
      },
    });
    cashierUserA = { id: cashierA.id, name: cashierA.name, role: cashierA.role, pharmacyId: pharmacyAId };

    const staffA = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Staff User A",
        email: `dash_staff_a_${timestamp}@example.com`,
        role: Role.STAFF,
        status: UserStatus.ACTIVE,
      },
    });
    staffUserA = { id: staffA.id, name: staffA.name, role: staffA.role, pharmacyId: pharmacyAId };

    // Setup Owner for Pharmacy B
    const ownerB = await prisma.user.create({
      data: {
        pharmacyId: pharmacyBId,
        name: "Owner User B",
        email: `dash_owner_b_${timestamp}@example.com`,
        role: Role.PHARMACY_OWNER,
        status: UserStatus.ACTIVE,
      },
    });
    ownerUserB = { id: ownerB.id, name: ownerB.name, role: ownerB.role, pharmacyId: pharmacyBId };

    // 4. Setup Medicines & Batches for Pharmacy A
    // Medicine 1: Active, minStockLevel = 50. Total available stock = 20 + 10 = 30 (< 50 => LOW STOCK)
    const med1 = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Napa Extra ${timestamp}`,
        genericName: "Paracetamol + Caffeine",
        company: "Beximco",
        minStockLevel: 50,
        status: MedicineStatus.ACTIVE,
      },
    });

    // Batch 1 for Med 1: 20 pcs sellable, expires next year
    const nextYearDate = new Date(Date.UTC(boundaries.year + 1, boundaries.month - 1, 15));
    const batch1 = await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: med1.id,
        batchNo: `B1-${timestamp}`,
        expiryDate: nextYearDate,
        purchasePrice: 2.0,
        sellingPrice: 3.0,
        receivedQty: 50,
        availableQty: 20,
      },
    });

    // Batch 2 for Med 1: 10 pcs sellable, expires next year
    await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: med1.id,
        batchNo: `B2-${timestamp}`,
        expiryDate: nextYearDate,
        purchasePrice: 2.2,
        sellingPrice: 3.5,
        receivedQty: 30,
        availableQty: 10,
      },
    });

    // Stock Movement records to verify movements aren't double counted as current stock
    await prisma.stockMovement.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: med1.id,
        batchId: batch1.id,
        type: StockMovementType.PURCHASE,
        quantityPieces: 50,
        balanceAfter: 50,
      },
    });
    await prisma.stockMovement.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: med1.id,
        batchId: batch1.id,
        type: StockMovementType.SALE,
        quantityPieces: -30,
        balanceAfter: 20,
      },
    });

    // Medicine 2: Active, minStockLevel = 10. Available stock = 100 (NOT low stock)
    const med2 = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Seclo 20 ${timestamp}`,
        genericName: "Omeprazole",
        company: "Square",
        minStockLevel: 10,
        status: MedicineStatus.ACTIVE,
      },
    });

    // Batch for Med 2: Expiring soon (within 15 days), availableQty = 100
    const expiringSoonDate = new Date(
      Date.UTC(boundaries.year, boundaries.month - 1, boundaries.day + 15)
    );
    await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: med2.id,
        batchNo: `B-EXP-SOON-${timestamp}`,
        expiryDate: expiringSoonDate,
        purchasePrice: 4.0,
        sellingPrice: 6.0,
        receivedQty: 100,
        availableQty: 100,
      },
    });

    // Medicine 3: Active, minStockLevel = 0. Has an expired batch with stock > 0, and depleted batch
    const med3 = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Ace Plus ${timestamp}`,
        genericName: "Paracetamol",
        company: "Square",
        minStockLevel: 0,
        status: MedicineStatus.ACTIVE,
      },
    });

    // Expired batch with stock (availableQty = 15)
    const pastDate = new Date(Date.UTC(boundaries.year - 1, 0, 15));
    await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: med3.id,
        batchNo: `B-EXPIRED-${timestamp}`,
        expiryDate: pastDate,
        purchasePrice: 1.0,
        sellingPrice: 2.0,
        receivedQty: 50,
        availableQty: 15,
      },
    });

    // Depleted expired batch (availableQty = 0) - should NOT count in expired stock count
    await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyAId,
        medicineId: med3.id,
        batchNo: `B-DEPLETED-${timestamp}`,
        expiryDate: pastDate,
        purchasePrice: 1.0,
        sellingPrice: 2.0,
        receivedQty: 20,
        availableQty: 0,
      },
    });

    // Medicine 4: Inactive Medicine in Pharmacy A
    await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Discontinued Med ${timestamp}`,
        status: MedicineStatus.INACTIVE,
      },
    });

    // Medicine in Pharmacy B (cross-tenant)
    const medB = await prisma.medicine.create({
      data: {
        pharmacyId: pharmacyBId,
        name: `Pharma B Med ${timestamp}`,
        minStockLevel: 200,
        status: MedicineStatus.ACTIVE,
      },
    });
    await prisma.medicineBatch.create({
      data: {
        pharmacyId: pharmacyBId,
        medicineId: medB.id,
        batchNo: `B-PHARMA-B-${timestamp}`,
        expiryDate: nextYearDate,
        purchasePrice: 5.0,
        sellingPrice: 10.0,
        receivedQty: 50,
        availableQty: 50,
      },
    });

    // 5. Setup Customers & Customer Dues
    await prisma.customer.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Customer Due 1 ${timestamp}`,
        dueBalance: 500.5,
        isActive: true,
      },
    });
    await prisma.customer.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Customer Due 2 ${timestamp}`,
        dueBalance: 250.25,
        isActive: true,
      },
    });
    // Inactive customer with due - should be excluded
    await prisma.customer.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Customer Inactive ${timestamp}`,
        dueBalance: 1000.0,
        isActive: false,
      },
    });
    // Customer in Pharmacy B - should be excluded from Pharmacy A
    await prisma.customer.create({
      data: {
        pharmacyId: pharmacyBId,
        name: `Customer B ${timestamp}`,
        dueBalance: 9999.0,
        isActive: true,
      },
    });

    // 6. Setup Suppliers & Supplier Dues
    const sup1 = await prisma.supplier.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Supplier A1 ${timestamp}`,
        dueBalance: 1200.0,
        isActive: true,
      },
    });
    await prisma.supplier.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Supplier A2 ${timestamp}`,
        dueBalance: 300.0,
        isActive: true,
      },
    });
    // Inactive supplier with due - should be excluded
    await prisma.supplier.create({
      data: {
        pharmacyId: pharmacyAId,
        name: `Supplier Inactive ${timestamp}`,
        dueBalance: 5000.0,
        isActive: false,
      },
    });
    // Supplier in Pharmacy B - should be excluded
    const supB = await prisma.supplier.create({
      data: {
        pharmacyId: pharmacyBId,
        name: `Supplier B ${timestamp}`,
        dueBalance: 8888.0,
        isActive: true,
      },
    });

    // 7. Setup Expenses for Pharmacy A
    // Expense today
    await prisma.expense.create({
      data: {
        pharmacyId: pharmacyAId,
        category: ExpenseCategory.RENT,
        amount: 2500.0,
        expenseDate: boundaries.todayDate,
        createdById: ownerUserA.id,
      },
    });
    // Another expense today
    await prisma.expense.create({
      data: {
        pharmacyId: pharmacyAId,
        category: ExpenseCategory.ELECTRICITY,
        amount: 500.0,
        expenseDate: boundaries.todayDate,
        createdById: ownerUserA.id,
      },
    });
    // Soft-deleted expense today - MUST BE EXCLUDED
    await prisma.expense.create({
      data: {
        pharmacyId: pharmacyAId,
        category: ExpenseCategory.UTILITY,
        amount: 10000.0,
        expenseDate: boundaries.todayDate,
        deletedAt: new Date(),
        createdById: ownerUserA.id,
      },
    });
    // Expense in past month
    const pastMonthDate = new Date(Date.UTC(boundaries.year, boundaries.month - 2, 15));
    await prisma.expense.create({
      data: {
        pharmacyId: pharmacyAId,
        category: ExpenseCategory.SALARY,
        amount: 20000.0,
        expenseDate: pastMonthDate,
        createdById: ownerUserA.id,
      },
    });
    // Expense in Pharmacy B
    await prisma.expense.create({
      data: {
        pharmacyId: pharmacyBId,
        category: ExpenseCategory.RENT,
        amount: 40000.0,
        expenseDate: boundaries.todayDate,
        createdById: ownerUserB.id,
      },
    });

    // 8. Setup Purchases for Pharmacy A
    // Today Completed Purchase (Total: 4000)
    const purch1 = await prisma.purchase.create({
      data: {
        pharmacyId: pharmacyAId,
        supplierId: sup1.id,
        invoiceNo: `PUR-TODAY-${timestamp}`,
        purchaseDate: boundaries.todayDate,
        totalAmount: 4000.0,
        paidAmount: 4000.0,
        status: PurchaseStatus.COMPLETED,
        createdById: ownerUserA.id,
      },
    });
    // Today Cancelled Purchase (Total: 6000) - MUST BE EXCLUDED
    await prisma.purchase.create({
      data: {
        pharmacyId: pharmacyAId,
        supplierId: sup1.id,
        invoiceNo: `PUR-CANCEL-${timestamp}`,
        purchaseDate: boundaries.todayDate,
        totalAmount: 6000.0,
        paidAmount: 0.0,
        status: PurchaseStatus.CANCELLED,
        cancelReason: "Cancelled by owner test",
        createdById: ownerUserA.id,
      },
    });
    // Earlier this month Completed Purchase (Total: 3000)
    // Use day 1 of month (or todayDate if today is day 1)
    const earlierMonthDay = boundaries.day > 1 ? 1 : boundaries.day;
    const earlierMonthPurchaseDate = new Date(
      Date.UTC(boundaries.year, boundaries.month - 1, earlierMonthDay)
    );
    await prisma.purchase.create({
      data: {
        pharmacyId: pharmacyAId,
        supplierId: sup1.id,
        invoiceNo: `PUR-MONTH-${timestamp}`,
        purchaseDate: earlierMonthPurchaseDate,
        totalAmount: 3000.0,
        paidAmount: 3000.0,
        status: PurchaseStatus.COMPLETED,
        createdById: ownerUserA.id,
      },
    });
    // Purchase in Pharmacy B
    await prisma.purchase.create({
      data: {
        pharmacyId: pharmacyBId,
        supplierId: supB.id,
        invoiceNo: `PUR-B-${timestamp}`,
        purchaseDate: boundaries.todayDate,
        totalAmount: 90000.0,
        status: PurchaseStatus.COMPLETED,
        createdById: ownerUserB.id,
      },
    });

    // 9. Setup Sales for Pharmacy A
    // Sale 1: Created by Owner today, COMPLETED (Total: 1000)
    const sale1SoldAt = new Date(boundaries.startOfTodayUtc.getTime() + 2 * 3600 * 1000); // 02:00 Dhaka today
    const sale1 = await prisma.sale.create({
      data: {
        pharmacyId: pharmacyAId,
        invoiceSeq: 1,
        invoiceNo: `INV-OWNER-${timestamp}`,
        subtotal: 1000.0,
        discountType: DiscountType.NONE,
        discountAmount: 0.0,
        totalAmount: 1000.0,
        paidAmount: 1000.0,
        dueAmount: 0.0,
        soldAt: sale1SoldAt,
        status: SaleStatus.COMPLETED,
        createdById: ownerUserA.id,
        items: {
          create: [
            {
              medicineId: med1.id,
              batchId: batch1.id,
              enteredUnit: UnitName.PIECE,
              enteredQty: 100,
              quantityPieces: 100,
              unitPricePerPiece: 10.0,
              costPricePerPiece: 6.0,
              lineSubtotal: 1000.0,
              returnedQtyPieces: 0,
            },
          ],
        },
      },
    });

    // Sale 2: Created by Cashier today, COMPLETED (Total: 500)
    const sale2SoldAt = new Date(boundaries.startOfTodayUtc.getTime() + 4 * 3600 * 1000); // 04:00 Dhaka today
    await prisma.sale.create({
      data: {
        pharmacyId: pharmacyAId,
        invoiceSeq: 2,
        invoiceNo: `INV-CSH-${timestamp}`,
        subtotal: 500.0,
        discountAmount: 0.0,
        totalAmount: 500.0,
        paidAmount: 500.0,
        dueAmount: 0.0,
        soldAt: sale2SoldAt,
        status: SaleStatus.COMPLETED,
        createdById: cashierUserA.id,
        items: {
          create: [
            {
              medicineId: med1.id,
              batchId: batch1.id,
              enteredUnit: UnitName.PIECE,
              enteredQty: 50,
              quantityPieces: 50,
              unitPricePerPiece: 10.0,
              costPricePerPiece: 6.0,
              lineSubtotal: 500.0,
              returnedQtyPieces: 0,
            },
          ],
        },
      },
    });

    // Sale 3: Created by Staff today, COMPLETED (Total: 300)
    const sale3SoldAt = new Date(boundaries.startOfTodayUtc.getTime() + 5 * 3600 * 1000);
    await prisma.sale.create({
      data: {
        pharmacyId: pharmacyAId,
        invoiceSeq: 3,
        invoiceNo: `INV-STF-${timestamp}`,
        subtotal: 300.0,
        discountAmount: 0.0,
        totalAmount: 300.0,
        paidAmount: 300.0,
        dueAmount: 0.0,
        soldAt: sale3SoldAt,
        status: SaleStatus.COMPLETED,
        createdById: staffUserA.id,
        items: {
          create: [
            {
              medicineId: med1.id,
              batchId: batch1.id,
              enteredUnit: UnitName.PIECE,
              enteredQty: 30,
              quantityPieces: 30,
              unitPricePerPiece: 10.0,
              costPricePerPiece: 6.0,
              lineSubtotal: 300.0,
              returnedQtyPieces: 0,
            },
          ],
        },
      },
    });

    // Sale 4: Cancelled sale today (Total: 800) - MUST BE EXCLUDED FROM SALES & PROFIT
    await prisma.sale.create({
      data: {
        pharmacyId: pharmacyAId,
        invoiceSeq: 4,
        invoiceNo: `INV-CANCELLED-${timestamp}`,
        subtotal: 800.0,
        discountAmount: 0.0,
        totalAmount: 800.0,
        paidAmount: 0.0,
        dueAmount: 0.0,
        soldAt: sale1SoldAt,
        status: SaleStatus.CANCELLED,
        cancelReason: "Cancelled test sale",
        createdById: ownerUserA.id,
        items: {
          create: [
            {
              medicineId: med1.id,
              batchId: batch1.id,
              enteredUnit: UnitName.PIECE,
              enteredQty: 80,
              quantityPieces: 80,
              unitPricePerPiece: 10.0,
              costPricePerPiece: 6.0,
              lineSubtotal: 800.0,
            },
          ],
        },
      },
    });

    // Sale 5: Earlier this month (if today is not 1st) or current month sale
    // We set soldAt to startOfMonthUtc + 1 hour so it strictly belongs to current month
    const monthSaleSoldAt = new Date(boundaries.startOfMonthUtc.getTime() + 3600 * 1000);
    await prisma.sale.create({
      data: {
        pharmacyId: pharmacyAId,
        invoiceSeq: 5,
        invoiceNo: `INV-MONTH-${timestamp}`,
        subtotal: 1200.0,
        discountAmount: 200.0, // invoice discount of 200
        totalAmount: 1000.0,
        paidAmount: 1000.0,
        dueAmount: 0.0,
        soldAt: monthSaleSoldAt,
        status: SaleStatus.COMPLETED,
        createdById: ownerUserA.id,
        items: {
          create: [
            {
              medicineId: med1.id,
              batchId: batch1.id,
              enteredUnit: UnitName.PIECE,
              enteredQty: 120,
              quantityPieces: 120,
              unitPricePerPiece: 10.0,
              costPricePerPiece: 5.0,
              lineSubtotal: 1200.0,
            },
          ],
        },
      },
    });

    // Sale 6: Last month sale - MUST BE EXCLUDED from current month
    const lastMonthSoldAt = new Date(boundaries.startOfMonthUtc.getTime() - 24 * 3600 * 1000);
    await prisma.sale.create({
      data: {
        pharmacyId: pharmacyAId,
        invoiceSeq: 6,
        invoiceNo: `INV-PREV-MONTH-${timestamp}`,
        subtotal: 5000.0,
        totalAmount: 5000.0,
        paidAmount: 5000.0,
        dueAmount: 0.0,
        soldAt: lastMonthSoldAt,
        status: SaleStatus.COMPLETED,
        createdById: ownerUserA.id,
      },
    });

    // Sale 7: Pharmacy B Sale
    await prisma.sale.create({
      data: {
        pharmacyId: pharmacyBId,
        invoiceSeq: 1,
        invoiceNo: `INV-B-${timestamp}`,
        subtotal: 7777.0,
        totalAmount: 7777.0,
        paidAmount: 7777.0,
        dueAmount: 0.0,
        soldAt: sale1SoldAt,
        status: SaleStatus.COMPLETED,
        createdById: ownerUserB.id,
      },
    });

    // 10. Setup Returns for Pharmacy A
    // Sale Return on Sale 1
    await prisma.saleReturn.create({
      data: {
        pharmacyId: pharmacyAId,
        saleId: sale1.id,
        returnNo: `SR-TEST-${timestamp}`,
        reason: "Patient allergic reaction",
        itemsAmount: 100.0,
        discountShare: 0.0,
        refundAmount: 100.0,
        createdById: ownerUserA.id,
      },
    });

    // Purchase Return on Purchase 1
    await prisma.purchaseReturn.create({
      data: {
        pharmacyId: pharmacyAId,
        supplierId: sup1.id,
        purchaseId: purch1.id,
        returnNo: `PR-TEST-${timestamp}`,
        reason: PurchaseReturnReason.DAMAGED,
        totalAmount: 200.0,
        createdById: ownerUserA.id,
      },
    });

    // Return in Pharmacy B
    await prisma.purchaseReturn.create({
      data: {
        pharmacyId: pharmacyBId,
        supplierId: supB.id,
        purchaseId: (await prisma.purchase.findFirst({ where: { pharmacyId: pharmacyBId } }))!.id,
        returnNo: `PR-B-${timestamp}`,
        reason: PurchaseReturnReason.WRONG_ITEM,
        totalAmount: 9999.0,
        createdById: ownerUserB.id,
      },
    });
  });

  after(async () => {
    try {
      await prisma.purchaseReturn.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.saleReturn.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.saleItem.deleteMany({ where: { sale: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } } });
      await prisma.sale.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.purchase.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.stockMovement.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.medicineBatch.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.medicine.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.expense.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.customer.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.supplier.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.user.deleteMany({ where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } } });
      await prisma.pharmacy.deleteMany({ where: { id: { in: [pharmacyAId, pharmacyBId] } } });
    } catch (err) {
      console.warn("Cleanup error (ignored):", err);
    } finally {
      await prisma.$disconnect();
      redis.disconnect();
    }
  });

  // ==========================================
  // Test Cases 1 - 20
  // ==========================================

  test("1. Owner receives the full dashboard with all metrics sections", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    assert.equal(data.role, "PHARMACY_OWNER");
    assert.ok(data.sales, "Sales object must be present");
    assert.ok(data.purchases, "Purchases object must be present");
    assert.ok(data.medicines, "Medicines object must be present");
    assert.ok(data.inventory, "Inventory object must be present");
    assert.ok(data.dues, "Dues object must be present");
    assert.ok(data.expenses, "Expenses object must be present");
    assert.ok(data.profit, "Profit object must be present");
    assert.ok(Array.isArray(data.recentReturns), "recentReturns must be an array");
  });

  test("2. Cashier receives only their sales today and low-stock information", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, cashierUserA)) as any;

    assert.equal(data.role, "CASHIER");
    assert.ok(data.mySalesToday, "mySalesToday must be present");
    assert.ok(data.lowStock, "lowStock must be present");

    // Owner-only fields must NOT exist in the response
    assert.equal(data.sales, undefined, "Cashier response must NOT contain overall sales");
    assert.equal(data.purchases, undefined, "Cashier response must NOT contain purchases");
    assert.equal(data.dues, undefined, "Cashier response must NOT contain dues");
    assert.equal(data.expenses, undefined, "Cashier response must NOT contain expenses");
    assert.equal(data.profit, undefined, "Cashier response must NOT contain profit");
    assert.equal(data.recentReturns, undefined, "Cashier response must NOT contain recentReturns");

    // Verify cashier sales total is exactly their own
    assert.equal(data.mySalesToday.totalAmount, 500.0);
    assert.equal(data.mySalesToday.count, 1);
  });

  test("3. Staff receives only their sales today and low-stock information", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, staffUserA)) as any;

    assert.equal(data.role, "STAFF");
    assert.ok(data.mySalesToday, "mySalesToday must be present");
    assert.ok(data.lowStock, "lowStock must be present");

    // Owner-only fields must NOT exist
    assert.equal(data.sales, undefined);
    assert.equal(data.purchases, undefined);
    assert.equal(data.profit, undefined);

    // Verify staff sales total is exactly their own
    assert.equal(data.mySalesToday.totalAmount, 300.0);
    assert.equal(data.mySalesToday.count, 1);
  });

  test("4. Unauthorized roles are rejected", async () => {
    const superAdminUser = {
      id: "super-admin-id",
      name: "Super Admin",
      role: Role.SUPER_ADMIN,
      pharmacyId: null,
    };

    await assert.rejects(
      async () => {
        await DashboardService.getDashboard(pharmacyAId, superAdminUser as any);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 403);
        return true;
      }
    );
  });

  test("5. Pharmacy tenant isolation is enforced", async () => {
    const dataA = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;
    const dataB = (await DashboardService.getDashboard(pharmacyBId, ownerUserB)) as any;

    // Dues must not leak across tenants
    assert.notEqual(dataA.dues.customerDue, dataB.dues.customerDue);
    assert.equal(dataB.dues.customerDue, 9999.0);

    // Expenses must not leak
    assert.equal(dataB.expenses.today.totalAmount, 40000.0);
    assert.notEqual(dataA.expenses.today.totalAmount, dataB.expenses.today.totalAmount);
  });

  test("6. Today's metrics use Asia/Dhaka boundaries", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Sales today includes Sale 1 (1000) + Sale 2 (500) + Sale 3 (300) = 1800.0
    // Excludes Sale 4 (Cancelled) and Sale 6 (Last month)
    assert.equal(data.sales.today.totalAmount, 1800.0);
    assert.equal(data.sales.today.count, 3);
  });

  test("7. Monthly metrics use the correct month boundaries", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Month sales includes Today's sales (1800) + earlier month Sale 5 (1000) = 2800.0
    // Excludes Sale 6 (5000 from last month)
    assert.equal(data.sales.currentMonth.totalAmount, 2800.0);
    assert.equal(data.sales.currentMonth.count, 4);
  });

  test("8. Cancelled invoices are excluded from sales totals", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // If cancelled sale (800) were included, today's sales would be 2600. It must be 1800!
    assert.equal(data.sales.today.totalAmount, 1800.0);
    assert.equal(data.sales.currentMonth.totalAmount, 2800.0);
  });

  test("9. Cancelled invoices are excluded from estimated profit", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Verify profit calculation excludes cancelled sale (INV-CANCELLED-...)
    // Total Net Sales for month = (Sale 1: 1000 - 100 return = 900) + (Sale 2: 500) + (Sale 3: 300) + (Sale 5: 1000) = 2700.0
    assert.equal(data.profit.totalNetSales, 2700.0);
  });

  test("10. Cashier/Staff sales include only records created by the authenticated employee", async () => {
    const cashierData = (await DashboardService.getDashboard(pharmacyAId, cashierUserA)) as any;
    const staffData = (await DashboardService.getDashboard(pharmacyAId, staffUserA)) as any;

    assert.equal(cashierData.mySalesToday.totalAmount, 500.0);
    assert.equal(cashierData.mySalesToday.count, 1);

    assert.equal(staffData.mySalesToday.totalAmount, 300.0);
    assert.equal(staffData.mySalesToday.count, 1);
  });

  test("11. Purchase totals exclude cancelled purchases", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Today's purchase completed is 4000. Cancelled is 6000.
    // Must be 4000, NOT 10000!
    assert.equal(data.purchases.today.totalAmount, 4000.0);
    assert.equal(data.purchases.today.count, 1);

    // Monthly purchase completed = today (4000) + earlier month (3000) = 7000.0
    assert.equal(data.purchases.currentMonth.totalAmount, 7000.0);
    assert.equal(data.purchases.currentMonth.count, 2);
  });

  test("12. Total medicines do not count batches as separate medicines", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // In Pharmacy A, we have Med 1, Med 2, Med 3 (Active) and Med 4 (Inactive).
    // Distinct total medicines = 4, Active distinct medicines = 3.
    // There are 5 batches across them - batches must NOT inflate the medicine count!
    assert.equal(data.medicines.total, 4);
    assert.equal(data.medicines.active, 3);
  });

  test("13. Total stock does not double count movements and batch quantities", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Med 1: Batch 1 (20) + Batch 2 (10) = 30
    // Med 2: Expiring Soon Batch (100) = 100
    // Med 3: Expired batch has 15 (excluded from available sellable stock)
    // Total sellable stock = 30 + 100 = 130 pieces
    // (StockMovement rows added in setup must NOT alter this current availableQty sum)
    assert.equal(data.medicines.totalStockPieces, 130);
    assert.equal(data.inventory.totalStockPieces, 130);
  });

  test("14. Low-stock calculations follow the existing inventory rules", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Med 1: minStockLevel = 50, available sellable stock = 30 -> LOW STOCK
    // Med 2: minStockLevel = 10, available sellable stock = 100 -> NOT low stock
    // Med 3: minStockLevel = 0 -> NOT low stock
    assert.equal(data.inventory.lowStockCount, 1);

    const cashierData = (await DashboardService.getDashboard(pharmacyAId, cashierUserA)) as any;
    assert.equal(cashierData.lowStock.count, 1);
    assert.equal(cashierData.lowStock.items[0].minStockLevel, 50);
    assert.equal(cashierData.lowStock.items[0].currentStock, 30);
    assert.equal((cashierData.lowStock.items[0] as any).costPrice, undefined, "No cost price for cashier");
  });

  test("15. Expiring and expired counts follow the established expiry policy", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Expiring soon: Batch B-EXP-SOON- expires in 15 days (availableQty = 100 > 0) -> count: 1
    assert.equal(data.inventory.expiringSoonCount, 1);
    assert.equal(data.inventory.expiringThresholdDays, 30);

    // Expired: Batch B-EXPIRED- has past expiryDate and availableQty = 15 > 0 -> count: 1
    // Batch B-DEPLETED- is expired but availableQty = 0 -> MUST NOT be counted!
    assert.equal(data.inventory.expiredCount, 1);
  });

  test("16. Customer and supplier dues are not double counted", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Customer dues: Cust 1 (500.5) + Cust 2 (250.25) = 750.75
    // Inactive customer (1000) excluded
    assert.equal(data.dues.customerDue, 750.75);

    // Supplier dues: Sup 1 (1200) + Sup 2 (300) = 1500.0
    // Inactive supplier (5000) excluded
    assert.equal(data.dues.supplierDue, 1500.0);
  });

  test("17. Today's expenses exclude soft-deleted expenses", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Today expenses: Rent (2500) + Electricity (500) = 3000.0
    // Soft-deleted Utility (10000) MUST BE EXCLUDED!
    assert.equal(data.expenses.today.totalAmount, 3000.0);
    assert.equal(data.expenses.today.count, 2);
  });

  test("18. Estimated profit uses historical cost data and correct discount handling where supported", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Profit is calculated on current month non-cancelled sales:
    // Sale 1: TotalAmount 1000, Return refund 100 -> Net sales = 900.
    //         Cost: 100 pcs * 6.0/pc = 600.
    // Sale 2: TotalAmount 500 -> Net sales = 500.
    //         Cost: 50 pcs * 6.0/pc = 300.
    // Sale 3: TotalAmount 300 -> Net sales = 300.
    //         Cost: 30 pcs * 6.0/pc = 180.
    // Sale 5: Subtotal 1200, discount 200, TotalAmount 1000 -> Net sales = 1000.
    //         Cost: 120 pcs * 5.0/pc = 600.
    // Total Net Sales = 900 + 500 + 300 + 1000 = 2700.0
    // Total COGS = 600 + 300 + 180 + 600 = 1680.0
    // Estimated Gross Profit = 2700.0 - 1680.0 = 1020.0
    assert.equal(data.profit.totalNetSales, 2700.0);
    assert.equal(data.profit.totalCostOfGoodsSold, 1680.0);
    assert.equal(data.profit.estimatedGrossProfit, 1020.0);
    assert.equal(data.profit.period, "current_month");
  });

  test("19. Recent returns are scoped to the authenticated pharmacy", async () => {
    const data = (await DashboardService.getDashboard(pharmacyAId, ownerUserA)) as any;

    // Recent returns must contain Pharmacy A returns (Sale return & Purchase return)
    // Must NOT contain Pharmacy B returns!
    assert.equal(data.recentReturns.length, 2);
    const returnTypes = data.recentReturns.map((r: any) => r.returnType);
    assert.ok(returnTypes.includes("SALE_RETURN"));
    assert.ok(returnTypes.includes("PURCHASE_RETURN"));

    const returnNumbers = data.recentReturns.map((r: any) => r.returnNo);
    assert.ok(!returnNumbers.includes(`PR-B-${timestamp}`), "Must not contain Pharmacy B return");
  });

  test("20. Dashboard reads do not modify business data", async () => {
    // Take snapshot of database counts and balances
    const salesBefore = await prisma.sale.count({ where: { pharmacyId: pharmacyAId } });
    const purchasesBefore = await prisma.purchase.count({ where: { pharmacyId: pharmacyAId } });
    const stockBefore = await prisma.medicineBatch.aggregate({
      where: { pharmacyId: pharmacyAId },
      _sum: { availableQty: true },
    });
    const customerDueBefore = await prisma.customer.aggregate({
      where: { pharmacyId: pharmacyAId },
      _sum: { dueBalance: true },
    });

    // Execute dashboard API call
    await DashboardService.getDashboard(pharmacyAId, ownerUserA);

    // Verify after call
    const salesAfter = await prisma.sale.count({ where: { pharmacyId: pharmacyAId } });
    const purchasesAfter = await prisma.purchase.count({ where: { pharmacyId: pharmacyAId } });
    const stockAfter = await prisma.medicineBatch.aggregate({
      where: { pharmacyId: pharmacyAId },
      _sum: { availableQty: true },
    });
    const customerDueAfter = await prisma.customer.aggregate({
      where: { pharmacyId: pharmacyAId },
      _sum: { dueBalance: true },
    });

    assert.equal(salesBefore, salesAfter, "Sales count must not change");
    assert.equal(purchasesBefore, purchasesAfter, "Purchases count must not change");
    assert.equal(
      stockBefore._sum.availableQty,
      stockAfter._sum.availableQty,
      "Stock must not change"
    );
    assert.equal(
      Number(customerDueBefore._sum.dueBalance),
      Number(customerDueAfter._sum.dueBalance),
      "Customer dues must not change"
    );
  });
});
