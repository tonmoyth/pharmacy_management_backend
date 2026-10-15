import { NotificationType, Role, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { sendEmail } from "../utils/email";

/**
 * Job 2: Expiry Emails
 * Schedule: Daily 08:00 Asia/Dhaka
 *
 * Rules:
 * - Email the Owner 7 days before expiry and again when it expires.
 * - Send once each, using dedupeKey to prevent duplicate emails.
 */
export const runExpiryEmailsJob = async (): Promise<{
  expiringEmailsSent: number;
  expiredEmailsSent: number;
}> => {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  let expiringEmailsSent = 0;
  let expiredEmailsSent = 0;

  // 1. Send warning email 7 days before expiry
  const expiringSubscriptions = await prisma.subscription.findMany({
    where: {
      status: {
        in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRING_SOON],
      },
      endDate: {
        gte: now,
        lte: sevenDaysFromNow,
      },
    },
    include: {
      plan: true,
      pharmacy: {
        include: {
          users: {
            where: { role: Role.PHARMACY_OWNER },
            take: 1,
          },
        },
      },
    },
  });

  for (const sub of expiringSubscriptions) {
    const dedupeKey = `email_sub_expiring_${sub.id}`;

    // Check if this email was already recorded/sent
    const alreadySent = await prisma.notification.findUnique({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId: sub.pharmacyId,
          dedupeKey,
        },
      },
    });

    if (!alreadySent) {
      const recipientEmail =
        sub.pharmacy.users[0]?.email || sub.pharmacy.email;
      const ownerName =
        sub.pharmacy.users[0]?.name || sub.pharmacy.ownerName || "Owner";
      const expiryFormatted = sub.endDate.toISOString().split("T")[0];

      try {
        await sendEmail(
          recipientEmail,
          `Subscription Expiring Soon - ${sub.pharmacy.name}`,
          `Dear ${ownerName},\n\nYour subscription for pharmacy "${sub.pharmacy.name}" (${sub.plan.name} plan) is expiring on ${expiryFormatted}.\n\nPlease renew your subscription to ensure uninterrupted service.\n\nBest regards,\nPharmacy Management Team`
        );
      } catch (err) {
        console.warn(`Failed to send expiry warning email to ${recipientEmail}:`, err);
      }

      // Record dedupeKey to ensure email is only sent once
      await prisma.notification.create({
        data: {
          pharmacyId: sub.pharmacyId,
          type: NotificationType.SUBSCRIPTION_EXPIRING,
          title: "Expiry Warning Email Sent",
          message: `Subscription expiry warning email sent to ${recipientEmail} for plan '${sub.plan.name}'.`,
          refType: "Subscription",
          refId: sub.id,
          dedupeKey,
        },
      });

      expiringEmailsSent++;
    }
  }

  // 2. Send email when subscription expires
  const expiredSubscriptions = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.EXPIRED,
    },
    include: {
      plan: true,
      pharmacy: {
        include: {
          users: {
            where: { role: Role.PHARMACY_OWNER },
            take: 1,
          },
        },
      },
    },
  });

  for (const sub of expiredSubscriptions) {
    const dedupeKey = `email_sub_expired_${sub.id}`;

    const alreadySent = await prisma.notification.findUnique({
      where: {
        pharmacyId_dedupeKey: {
          pharmacyId: sub.pharmacyId,
          dedupeKey,
        },
      },
    });

    if (!alreadySent) {
      const recipientEmail =
        sub.pharmacy.users[0]?.email || sub.pharmacy.email;
      const ownerName =
        sub.pharmacy.users[0]?.name || sub.pharmacy.ownerName || "Owner";

      try {
        await sendEmail(
          recipientEmail,
          `Subscription Expired - ${sub.pharmacy.name}`,
          `Dear ${ownerName},\n\nYour subscription for pharmacy "${sub.pharmacy.name}" (${sub.plan.name} plan) has expired.\n\nPlease log in to your account and renew your plan to restore full access to all features.\n\nBest regards,\nPharmacy Management Team`
        );
      } catch (err) {
        console.warn(`Failed to send expired email to ${recipientEmail}:`, err);
      }

      await prisma.notification.create({
        data: {
          pharmacyId: sub.pharmacyId,
          type: NotificationType.SUBSCRIPTION_EXPIRED,
          title: "Subscription Expired Email Sent",
          message: `Subscription expired notification email sent to ${recipientEmail} for plan '${sub.plan.name}'.`,
          refType: "Subscription",
          refId: sub.id,
          dedupeKey,
        },
      });

      expiredEmailsSent++;
    }
  }

  return { expiringEmailsSent, expiredEmailsSent };
};
