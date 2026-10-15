import { NotificationType, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Job 1: Subscription Status
 * Schedule: Daily 00:05 Asia/Dhaka
 *
 * Rules:
 * - ACTIVE -> EXPIRING_SOON when endDate is within 7 days.
 * - ACTIVE / EXPIRING_SOON -> EXPIRED when endDate has passed.
 * - Set pharmacy.archiveAt = now + 90 days when expired.
 * - Create SUBSCRIPTION_EXPIRING and SUBSCRIPTION_EXPIRED notifications with dedupeKey.
 */
export const runSubscriptionStatusJob = async (): Promise<{
  expiringSoonCount: number;
  expiredCount: number;
}> => {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  let expiringSoonCount = 0;
  let expiredCount = 0;

  // 1. ACTIVE -> EXPIRING_SOON (endDate within next 7 days, but not in the past)
  const expiringSubscriptions = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      endDate: {
        gte: now,
        lte: sevenDaysFromNow,
      },
    },
    include: {
      plan: true,
      pharmacy: true,
    },
  });

  for (const sub of expiringSubscriptions) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SubscriptionStatus.EXPIRING_SOON },
    });

    const dedupeKey = `sub_expiring_${sub.id}`;
    const expiryDateFormatted = sub.endDate.toISOString().split("T")[0];

    await prisma.notification.upsert({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId: sub.pharmacyId,
          dedupeKey,
        },
      },
      update: {
        title: "Subscription Expiring Soon",
        message: `Your subscription for plan '${sub.plan.name}' expires on ${expiryDateFormatted}. Please renew your plan soon.`,
      },
      create: {
        pharmacyId: sub.pharmacyId,
        type: NotificationType.SUBSCRIPTION_EXPIRING,
        title: "Subscription Expiring Soon",
        message: `Your subscription for plan '${sub.plan.name}' expires on ${expiryDateFormatted}. Please renew your plan soon.`,
        refType: "Subscription",
        refId: sub.id,
        dedupeKey,
      },
    });

    expiringSoonCount++;
  }

  // 2. ACTIVE / EXPIRING_SOON -> EXPIRED (endDate < now)
  const expiredSubscriptions = await prisma.subscription.findMany({
    where: {
      status: {
        in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRING_SOON],
      },
      endDate: {
        lt: now,
      },
    },
    include: {
      plan: true,
      pharmacy: true,
    },
  });

  for (const sub of expiredSubscriptions) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { status: SubscriptionStatus.EXPIRED },
    });

    // Set pharmacy archiveAt to 90 days from now if not already set
    if (!sub.pharmacy.archiveAt) {
      await prisma.pharmacy.update({
        where: { id: sub.pharmacyId },
        data: { archiveAt: ninetyDaysFromNow },
      });
    }

    const dedupeKey = `sub_expired_${sub.id}`;

    await prisma.notification.upsert({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId: sub.pharmacyId,
          dedupeKey,
        },
      },
      update: {
        title: "Subscription Expired",
        message: `Your subscription for plan '${sub.plan.name}' has expired. Please renew to restore full access.`,
      },
      create: {
        pharmacyId: sub.pharmacyId,
        type: NotificationType.SUBSCRIPTION_EXPIRED,
        title: "Subscription Expired",
        message: `Your subscription for plan '${sub.plan.name}' has expired. Please renew to restore full access.`,
        refType: "Subscription",
        refId: sub.id,
        dedupeKey,
      },
    });

    expiredCount++;
  }

  return { expiringSoonCount, expiredCount };
};
