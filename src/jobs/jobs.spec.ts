import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  NotificationType,
  PaymentStatus,
  PaymentType,
  PharmacyStatus,
  SubscriptionStatus,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  runSubscriptionStatusJob,
  runExpiryEmailsJob,
  runStockAlertsJob,
  runArchiveDeleteJob,
  runCleanupJob,
} from "./index";

describe("Scheduled Jobs (node-cron) Integration Tests", () => {
  const pharmacyId = "cmuznebub000hul3ko0ur8z55";
  let testPlanId = "";
  let testPaymentExpiringId = "";
  let testPaymentExpiredId = "";
  let testSubExpiringId = "";
  let testSubExpiredId = "";
  let testArchivePharmacyId = "";

  before(async () => {
    // 1. Create a test plan if needed
    let plan = await prisma.plan.findFirst();
    if (!plan) {
      plan = await prisma.plan.create({
        data: {
          name: "CRON_TEST_PLAN",
          durationDays: 30,
          price: 1000,
        },
      });
    }
    testPlanId = plan.id;

    // 2. Create Payments for subscriptions
    const now = new Date();
    const paymentExpiring = await prisma.payment.create({
      data: {
        type: PaymentType.NEW,
        pharmacyId,
        planId: testPlanId,
        amount: 1000,
        transactionId: `TRX-EXP-${Date.now()}`,
        senderNumber: "01700000000",
        paidAt: new Date(),
        status: PaymentStatus.SUCCESS,
      },
    });
    testPaymentExpiringId = paymentExpiring.id;

    const paymentExpired = await prisma.payment.create({
      data: {
        type: PaymentType.NEW,
        pharmacyId,
        planId: testPlanId,
        amount: 1000,
        transactionId: `TRX-PAST-${Date.now()}`,
        senderNumber: "01700000000",
        paidAt: new Date(),
        status: PaymentStatus.SUCCESS,
      },
    });
    testPaymentExpiredId = paymentExpired.id;

    // 3. Create an expiring soon subscription (ends in 3 days)
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const subExpiring = await prisma.subscription.create({
      data: {
        pharmacyId,
        planId: testPlanId,
        paymentId: testPaymentExpiringId,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date(now.getTime() - 27 * 24 * 60 * 60 * 1000),
        endDate: threeDaysFromNow,
      },
    });
    testSubExpiringId = subExpiring.id;

    // 4. Create an already expired subscription (ended 5 days ago)
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const subExpired = await prisma.subscription.create({
      data: {
        pharmacyId,
        planId: testPlanId,
        paymentId: testPaymentExpiredId,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000),
        endDate: fiveDaysAgo,
      },
    });
    testSubExpiredId = subExpired.id;

    // 5. Create an expired token for cleanup testing
    await prisma.passwordResetToken.create({
      data: {
        userId: "cmuznec23000jul3k7vnwcl5p",
        tokenHash: `CRON-RESET-${Date.now()}`,
        expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // expired yesterday
      },
    });

    await prisma.refreshToken.create({
      data: {
        userId: "cmuznec23000jul3k7vnwcl5p",
        tokenHash: `CRON-REFRESH-${Date.now()}`,
        expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // expired yesterday
      },
    });

    // 6. Create a pharmacy past archiveAt date
    const archivePharmacy = await prisma.pharmacy.create({
      data: {
        name: `CRON_ARCHIVE_PHARM_${Date.now()}`,
        ownerName: "Old Owner",
        phone: "01700998811",
        email: `archive_${Date.now()}@test.com`,
        address: "Dhaka",
        city: "Dhaka",
        area: "Dhanmondi",
        status: PharmacyStatus.DEACTIVATED,
        archiveAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // past archiveAt
      },
    });
    testArchivePharmacyId = archivePharmacy.id;
  });

  after(async () => {
    // Cleanup created test records
    await prisma.notification.deleteMany({
      where: {
        dedupeKey: {
          in: [
            `sub_expiring_${testSubExpiringId}`,
            `sub_expired_${testSubExpiredId}`,
            `email_sub_expiring_${testSubExpiringId}`,
            `email_sub_expired_${testSubExpiredId}`,
          ],
        },
      },
    });

    await prisma.subscription.deleteMany({
      where: {
        id: { in: [testSubExpiringId, testSubExpiredId].filter(Boolean) },
      },
    });

    await prisma.payment.deleteMany({
      where: {
        id: {
          in: [testPaymentExpiringId, testPaymentExpiredId].filter(Boolean),
        },
      },
    });

    if (testArchivePharmacyId) {
      await prisma.auditLog.deleteMany({
        where: { pharmacyId: testArchivePharmacyId },
      });
      await prisma.pharmacy.deleteMany({
        where: { id: testArchivePharmacyId },
      });
    }

    try {
      const { redis } = await import("../config/redis");
      redis.disconnect();
    } catch (_) {}
  });

  test("Job 1: Subscription Status updates ACTIVE -> EXPIRING_SOON and EXPIRED", async () => {
    const result = await runSubscriptionStatusJob();
    assert.ok(result.expiringSoonCount >= 1);
    assert.ok(result.expiredCount >= 1);

    // Verify subExpiring is now EXPIRING_SOON
    const updatedExpiring = await prisma.subscription.findUnique({
      where: { id: testSubExpiringId },
    });
    assert.equal(updatedExpiring?.status, SubscriptionStatus.EXPIRING_SOON);

    // Verify subExpired is now EXPIRED
    const updatedExpired = await prisma.subscription.findUnique({
      where: { id: testSubExpiredId },
    });
    assert.equal(updatedExpired?.status, SubscriptionStatus.EXPIRED);

    // Verify notifications created with dedupeKey
    const notifExpiring = await prisma.notification.findUnique({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId,
          dedupeKey: `sub_expiring_${testSubExpiringId}`,
        },
      },
    });
    assert.ok(notifExpiring);
    assert.equal(notifExpiring?.type, NotificationType.SUBSCRIPTION_EXPIRING);

    const notifExpired = await prisma.notification.findUnique({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId,
          dedupeKey: `sub_expired_${testSubExpiredId}`,
        },
      },
    });
    assert.ok(notifExpired);
    assert.equal(notifExpired?.type, NotificationType.SUBSCRIPTION_EXPIRED);
  });

  test("Job 2: Expiry Emails sends email alerts with dedupeKey protection", async () => {
    const result = await runExpiryEmailsJob();
    assert.ok(typeof result.expiringEmailsSent === "number");
    assert.ok(typeof result.expiredEmailsSent === "number");

    // Second run should send 0 because dedupeKey prevents duplicate sending
    const secondRun = await runExpiryEmailsJob();
    assert.equal(secondRun.expiringEmailsSent, 0);
    assert.equal(secondRun.expiredEmailsSent, 0);
  });

  test("Job 3: Stock & Due Alerts creates/refreshes notifications", async () => {
    const result = await runStockAlertsJob();
    assert.ok(typeof result.lowStockCount === "number");
    assert.ok(typeof result.expiringSoonCount === "number");
    assert.ok(typeof result.expiredCount === "number");
    assert.ok(typeof result.customerDueCount === "number");
    assert.ok(typeof result.supplierDueCount === "number");
  });

  test("Job 4: Archive / Delete archives inactive pharmacies past archiveAt", async () => {
    const result = await runArchiveDeleteJob();
    assert.ok(result.archivedPharmaciesCount >= 1);

    const archivedPharm = await prisma.pharmacy.findUnique({
      where: { id: testArchivePharmacyId },
    });
    assert.ok(archivedPharm?.archivedAt !== null);
    assert.equal(archivedPharm?.status, PharmacyStatus.DEACTIVATED);
  });

  test("Job 5: Cleanup removes expired RefreshTokens, PasswordResetTokens, and Sessions", async () => {
    const result = await runCleanupJob();
    assert.ok(result.deletedResetTokens >= 1);
    assert.ok(result.deletedRefreshTokens >= 1);
  });
});
