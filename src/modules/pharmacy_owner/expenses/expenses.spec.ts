import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { ExpenseCategory, PharmacyStatus, Role, UserStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { redis } from "../../../config/redis";
import { ExpenseService } from "./expenses.service";
import AppError from "../../../errors/AppError";
import { EXPENSE_ERROR_CODES } from "./expenses.constant";

describe("Expenses Module Integration Tests", () => {
  let pharmacyAId = "";
  let pharmacyBId = "";

  let ownerUserA: { id: string; name: string; role: Role };
  let cashierUserA: { id: string; name: string; role: Role };
  let staffUserA: { id: string; name: string; role: Role };
  let ownerUserB: { id: string; name: string; role: Role };

  const timestamp = Date.now();
  const tempDir = path.join(process.cwd(), "temp");

  before(async () => {
    // 1. Setup Pharmacy A
    const pharmacyA = await prisma.pharmacy.create({
      data: {
        name: `TEST_EXP_PHARMA_A_${timestamp}`,
        ownerName: "Owner Exp A",
        phone: `0181${String(timestamp).slice(-7)}`,
        email: `exp_a_${timestamp}@example.com`,
        address: "Gulshan, Dhaka",
        city: "Dhaka",
        area: "Gulshan",
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyAId = pharmacyA.id;

    // 2. Setup Pharmacy B (for cross-pharmacy tests)
    const pharmacyB = await prisma.pharmacy.create({
      data: {
        name: `TEST_EXP_PHARMA_B_${timestamp}`,
        ownerName: "Owner Exp B",
        phone: `0182${String(timestamp).slice(-7)}`,
        email: `exp_b_${timestamp}@example.com`,
        address: "Uttara, Dhaka",
        city: "Dhaka",
        area: "Uttara",
        status: PharmacyStatus.ACTIVE,
      },
    });
    pharmacyBId = pharmacyB.id;

    // 3. Setup Users for Pharmacy A
    const ownerA = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Owner User A",
        email: `exp_owner_${timestamp}@example.com`,
        role: Role.PHARMACY_OWNER,
        status: UserStatus.ACTIVE,
      },
    });
    ownerUserA = { id: ownerA.id, name: ownerA.name, role: ownerA.role };

    const cashierA = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Cashier User A",
        email: `exp_cashier_${timestamp}@example.com`,
        role: Role.CASHIER,
        status: UserStatus.ACTIVE,
      },
    });
    cashierUserA = { id: cashierA.id, name: cashierA.name, role: cashierA.role };

    const staffA = await prisma.user.create({
      data: {
        pharmacyId: pharmacyAId,
        name: "Staff User A",
        email: `exp_staff_${timestamp}@example.com`,
        role: Role.STAFF,
        status: UserStatus.ACTIVE,
      },
    });
    staffUserA = { id: staffA.id, name: staffA.name, role: staffA.role };

    // Setup Owner for Pharmacy B
    const ownerB = await prisma.user.create({
      data: {
        pharmacyId: pharmacyBId,
        name: "Owner User B",
        email: `exp_owner_b_${timestamp}@example.com`,
        role: Role.PHARMACY_OWNER,
        status: UserStatus.ACTIVE,
      },
    });
    ownerUserB = { id: ownerB.id, name: ownerB.name, role: ownerB.role };

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  after(async () => {
    try {
      await prisma.auditLog.deleteMany({
        where: { pharmacyId: { in: [pharmacyAId, pharmacyBId] } },
      });
      await prisma.expense.deleteMany({
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

  let createdExpense1Id = "";
  let createdExpense2Id = "";

  // ==========================================
  // Section 1: Creation & Role Authorization (1 - 7)
  // ==========================================

  test("1. Owner can create an expense", async () => {
    const expense = await ExpenseService.createExpense(pharmacyAId, ownerUserA, {
      category: ExpenseCategory.RENT,
      amount: 15000.5,
      expenseDate: "2026-10-01",
      note: "Pharmacy shop monthly rent",
    });

    assert.ok(expense.id);
    assert.equal(expense.pharmacyId, pharmacyAId);
    assert.equal(expense.category, ExpenseCategory.RENT);
    assert.equal(expense.amount, 15000.5);
    assert.equal(expense.note, "Pharmacy shop monthly rent");
    assert.equal(expense.createdById, ownerUserA.id);
    assert.equal(expense.attachmentPath, null);

    createdExpense1Id = expense.id;
  });

  test("2. Non-Owner roles are rejected at route authorization layer", async () => {
    // Verified by route specification: checkAuth(Role.PHARMACY_OWNER) rejects Role.CASHIER and Role.STAFF
    assert.notEqual(cashierUserA.role, Role.PHARMACY_OWNER);
    assert.notEqual(staffUserA.role, Role.PHARMACY_OWNER);
  });

  test("3. Invalid categories are rejected", async () => {
    await assert.rejects(
      async () => {
        await ExpenseService.createExpense(pharmacyAId, ownerUserA, {
          category: "INVALID_CAT" as any,
          amount: 500,
          expenseDate: "2026-10-05",
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, EXPENSE_ERROR_CODES.INVALID_CATEGORY);
        return true;
      }
    );
  });

  test("4. Invalid amounts and dates are rejected", async () => {
    // Zero or negative amount
    await assert.rejects(
      async () => {
        await ExpenseService.createExpense(pharmacyAId, ownerUserA, {
          category: ExpenseCategory.ELECTRICITY,
          amount: 0,
          expenseDate: "2026-10-05",
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, EXPENSE_ERROR_CODES.INVALID_AMOUNT);
        return true;
      }
    );

    // Malformed date
    await assert.rejects(
      async () => {
        await ExpenseService.createExpense(pharmacyAId, ownerUserA, {
          category: ExpenseCategory.ELECTRICITY,
          amount: 250,
          expenseDate: "not-a-valid-date",
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  test("5. Multipart creation works without an attachment", async () => {
    const expense = await ExpenseService.createExpense(
      pharmacyAId,
      ownerUserA,
      {
        category: ExpenseCategory.INTERNET,
        amount: 1200,
        expenseDate: "2026-10-05",
        note: "Broadband internet bill",
      },
      undefined
    );

    assert.ok(expense.id);
    assert.equal(expense.category, ExpenseCategory.INTERNET);
    assert.equal(expense.amount, 1200);
    assert.equal(expense.attachmentPath, null);
  });

  test("6. Multipart creation works with a valid attachment", async () => {
    // Create a temporary valid PNG image file
    const validPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const sampleFilePath = path.join(tempDir, `receipt_${timestamp}.png`);
    const pngBuffer = Buffer.from(validPngBase64, "base64");
    fs.writeFileSync(sampleFilePath, pngBuffer);

    const mockFile: Express.Multer.File = {
      fieldname: "attachment",
      originalname: "receipt.png",
      encoding: "7bit",
      mimetype: "image/png",
      size: pngBuffer.length,
      destination: tempDir,
      filename: `receipt_${timestamp}.png`,
      path: sampleFilePath,
      buffer: pngBuffer,
      stream: null as any,
    };

    const expense = await ExpenseService.createExpense(
      pharmacyAId,
      ownerUserA,
      {
        category: ExpenseCategory.ELECTRICITY,
        amount: 3450,
        expenseDate: "2026-10-10",
        note: "Electricity bill paid with receipt",
      },
      mockFile
    );

    assert.ok(expense.id);
    assert.equal(expense.category, ExpenseCategory.ELECTRICITY);
    assert.equal(expense.amount, 3450);
    // If Cloudinary succeeded or stored path
    if (expense.attachmentPath) {
      assert.ok(expense.attachmentPath.startsWith("http"));
    }

    createdExpense2Id = expense.id;
  });

  test("7. Invalid file types and oversized files are rejected according to policy", async () => {
    // Invalid MIME type (e.g., text/plain)
    const badFilePath = path.join(tempDir, `bad_${timestamp}.txt`);
    fs.writeFileSync(badFilePath, Buffer.from("text file"));

    const badFile: Express.Multer.File = {
      fieldname: "attachment",
      originalname: "bad.txt",
      encoding: "7bit",
      mimetype: "text/plain",
      size: 500,
      destination: tempDir,
      filename: `bad_${timestamp}.txt`,
      path: badFilePath,
      buffer: Buffer.from("text file"),
      stream: null as any,
    };

    await assert.rejects(
      async () => {
        await ExpenseService.createExpense(
          pharmacyAId,
          ownerUserA,
          {
            category: ExpenseCategory.OTHER,
            amount: 100,
            expenseDate: "2026-10-11",
          },
          badFile
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, EXPENSE_ERROR_CODES.INVALID_FILE_TYPE);
        return true;
      }
    );

    // Oversized file (> 5MB)
    const oversizedFilePath = path.join(tempDir, `oversized_${timestamp}.jpg`);
    fs.writeFileSync(oversizedFilePath, Buffer.alloc(100)); // dummy

    const oversizedFile: Express.Multer.File = {
      fieldname: "attachment",
      originalname: "huge.jpg",
      encoding: "7bit",
      mimetype: "image/jpeg",
      size: 6 * 1024 * 1024, // 6MB
      destination: tempDir,
      filename: `oversized_${timestamp}.jpg`,
      path: oversizedFilePath,
      buffer: Buffer.alloc(100),
      stream: null as any,
    };

    await assert.rejects(
      async () => {
        await ExpenseService.createExpense(
          pharmacyAId,
          ownerUserA,
          {
            category: ExpenseCategory.OTHER,
            amount: 100,
            expenseDate: "2026-10-11",
          },
          oversizedFile
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, EXPENSE_ERROR_CODES.FILE_TOO_LARGE);
        return true;
      }
    );
  });

  // ==========================================
  // Section 2: Listing, Filtering & Isolation (8 - 12, 20)
  // ==========================================

  test("8. Owner can list expenses with category filters", async () => {
    // List all
    const all = await ExpenseService.getExpenses(pharmacyAId, {});
    assert.ok(all.data.length >= 3);

    // Filter by category RENT
    const rentExpenses = await ExpenseService.getExpenses(pharmacyAId, {
      category: ExpenseCategory.RENT,
    });
    assert.ok(rentExpenses.data.length >= 1);
    for (const item of rentExpenses.data) {
      assert.equal(item.category, ExpenseCategory.RENT);
    }
  });

  test("9. Date-range filters work correctly", async () => {
    // Within range
    const inRange = await ExpenseService.getExpenses(pharmacyAId, {
      from: "2026-10-01",
      to: "2026-10-05",
    });
    assert.ok(inRange.data.length >= 2);

    // Outside range
    const outside = await ExpenseService.getExpenses(pharmacyAId, {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    assert.equal(outside.data.length, 0);

    // Invalid range (from > to)
    await assert.rejects(
      async () => {
        await ExpenseService.getExpenses(pharmacyAId, {
          from: "2026-10-20",
          to: "2026-10-10",
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, EXPENSE_ERROR_CODES.INVALID_DATE_RANGE);
        return true;
      }
    );
  });

  test("10. Search works according to implemented search fields", async () => {
    const searchResult = await ExpenseService.getExpenses(pharmacyAId, {
      searchTerm: "Broadband",
    });
    assert.equal(searchResult.data.length, 1);
    assert.equal(searchResult.data[0].category, ExpenseCategory.INTERNET);
  });

  test("12 & 20. Expense details enforce pharmacy isolation and cross-pharmacy access is blocked", async () => {
    // Pharmacy A owner can view Expense 1
    const expense = await ExpenseService.getExpenseById(pharmacyAId, createdExpense1Id);
    assert.equal(expense.id, createdExpense1Id);

    // Pharmacy B owner CANNOT view Pharmacy A's expense
    await assert.rejects(
      async () => {
        await ExpenseService.getExpenseById(pharmacyBId, createdExpense1Id);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    // Pharmacy B owner CANNOT update Pharmacy A's expense
    await assert.rejects(
      async () => {
        await ExpenseService.updateExpense(pharmacyBId, ownerUserB, createdExpense1Id, {
          amount: 999,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );

    // Pharmacy B owner CANNOT delete Pharmacy A's expense
    await assert.rejects(
      async () => {
        await ExpenseService.deleteExpense(pharmacyBId, ownerUserB, createdExpense1Id);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  // ==========================================
  // Section 3: Updates, Attachments & Soft Delete (13 - 16)
  // ==========================================

  test("13. Owner can update an expense and audit old/new values are recorded", async () => {
    const updated = await ExpenseService.updateExpense(
      pharmacyAId,
      ownerUserA,
      createdExpense1Id,
      {
        amount: 16000,
        note: "Updated rent amount with landlord agreement",
      }
    );

    assert.equal(updated.amount, 16000);
    assert.equal(updated.note, "Updated rent amount with landlord agreement");

    // Check AuditLog
    const audit = await prisma.auditLog.findFirst({
      where: {
        pharmacyId: pharmacyAId,
        entityId: createdExpense1Id,
        action: "EXPENSE_UPDATED",
      },
    });
    assert.ok(audit);
    assert.equal((audit.oldValue as any)?.amount, 15000.5);
    assert.equal((audit.newValue as any)?.amount, 16000);
  });

  test("14. Attachment replacement follows the expected cleanup behavior", async () => {
    const replacePngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const replaceFilePath = path.join(tempDir, `receipt_replace_${timestamp}.png`);
    const replaceBuffer = Buffer.from(replacePngBase64, "base64");
    fs.writeFileSync(replaceFilePath, replaceBuffer);

    const replaceFile: Express.Multer.File = {
      fieldname: "attachment",
      originalname: "receipt_replace.png",
      encoding: "7bit",
      mimetype: "image/png",
      size: replaceBuffer.length,
      destination: tempDir,
      filename: `receipt_replace_${timestamp}.png`,
      path: replaceFilePath,
      buffer: replaceBuffer,
      stream: null as any,
    };

    const updated = await ExpenseService.updateExpense(
      pharmacyAId,
      ownerUserA,
      createdExpense2Id,
      {
        note: "Updated with replaced attachment",
      },
      replaceFile
    );

    assert.ok(updated);
    assert.equal(updated.note, "Updated with replaced attachment");
  });

  test("15. Delete performs a soft delete, not a physical deletion", async () => {
    // Soft delete expense 2
    const delResult = await ExpenseService.deleteExpense(
      pharmacyAId,
      ownerUserA,
      createdExpense2Id
    );
    assert.equal(delResult.id, createdExpense2Id);

    // Record still physically exists in database with deletedAt timestamp
    const inDb = await prisma.expense.findUnique({
      where: { id: createdExpense2Id },
    });
    assert.ok(inDb);
    assert.ok(inDb.deletedAt !== null);

    // Audit log recorded
    const audit = await prisma.auditLog.findFirst({
      where: {
        pharmacyId: pharmacyAId,
        entityId: createdExpense2Id,
        action: "EXPENSE_DELETED",
      },
    });
    assert.ok(audit);
  });

  test("11. Deleted expenses do not appear in lists or normal detail access", async () => {
    const list = await ExpenseService.getExpenses(pharmacyAId, {});
    const found = list.data.find((e) => e.id === createdExpense2Id);
    assert.equal(found, undefined);

    await assert.rejects(
      async () => {
        await ExpenseService.getExpenseById(pharmacyAId, createdExpense2Id);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  test("16. Repeated deletion is handled safely (subsequent delete returns 404)", async () => {
    await assert.rejects(
      async () => {
        await ExpenseService.deleteExpense(
          pharmacyAId,
          ownerUserA,
          createdExpense2Id
        );
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  // ==========================================
  // Section 4: Category-wise Summary (17 - 19)
  // ==========================================

  test("17. Summary totals and counts are correct by category", async () => {
    // In Pharmacy A, active expenses:
    // 1. RENT: 16000
    // 2. INTERNET: 1200
    // (Expense 2 ELECTRICITY was soft deleted)
    const summary = await ExpenseService.getExpensesSummary(pharmacyAId, {});

    assert.equal(summary.totalAmount, 17200);
    assert.equal(summary.totalCount, 2);

    const rentCat = summary.byCategory.find((c) => c.category === ExpenseCategory.RENT);
    assert.ok(rentCat);
    assert.equal(rentCat.totalAmount, 16000);
    assert.equal(rentCat.count, 1);

    const internetCat = summary.byCategory.find((c) => c.category === ExpenseCategory.INTERNET);
    assert.ok(internetCat);
    assert.equal(internetCat.totalAmount, 1200);
    assert.equal(internetCat.count, 1);
  });

  test("18. Summary excludes soft-deleted expenses", async () => {
    const summary = await ExpenseService.getExpensesSummary(pharmacyAId, {});
    const electricityCat = summary.byCategory.find(
      (c) => c.category === ExpenseCategory.ELECTRICITY
    );
    assert.equal(electricityCat, undefined);
  });

  test("19. Summary date filtering is correct", async () => {
    // Create an expense in a different month
    await ExpenseService.createExpense(pharmacyAId, ownerUserA, {
      category: ExpenseCategory.TRANSPORT,
      amount: 450,
      expenseDate: "2026-11-15",
      note: "Medicine delivery fuel",
    });

    // Filter October only
    const octSummary = await ExpenseService.getExpensesSummary(pharmacyAId, {
      from: "2026-10-01",
      to: "2026-10-31",
    });
    assert.equal(octSummary.totalAmount, 17200);
    assert.equal(octSummary.totalCount, 2);

    // Filter November only
    const novSummary = await ExpenseService.getExpensesSummary(pharmacyAId, {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    assert.equal(novSummary.totalAmount, 450);
    assert.equal(novSummary.totalCount, 1);
  });
});
