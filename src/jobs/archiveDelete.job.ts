import { PharmacyStatus, Role, UserStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

/**
 * Job 4: Archive / Delete
 * Schedule: Daily 02:00 Asia/Dhaka
 *
 * Rules:
 * - Pharmacies EXPIRED for more than 90 days, or past archiveAt (deactivated):
 *   archive their data, set archivedAt, deactivate users, and record audit log.
 */
export const runArchiveDeleteJob = async (): Promise<{
  archivedPharmaciesCount: number;
}> => {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  let archivedPharmaciesCount = 0;

  // Find candidate pharmacies that are not yet archived
  const candidatePharmacies = await prisma.pharmacy.findMany({
    where: {
      archivedAt: null,
      OR: [
        // 1. archiveAt date has arrived/passed
        {
          archiveAt: {
            lte: now,
          },
        },
        // 2. Deactivated for more than 90 days
        {
          status: PharmacyStatus.DEACTIVATED,
          deactivatedAt: {
            lte: ninetyDaysAgo,
          },
        },
      ],
    },
    include: {
      subscriptions: {
        orderBy: { endDate: "desc" },
        take: 1,
      },
    },
  });

  // Also find pharmacies where latest subscription expired more than 90 days ago
  const expiredSubsPharmacies = await prisma.pharmacy.findMany({
    where: {
      archivedAt: null,
      subscriptions: {
        some: {
          endDate: { lte: ninetyDaysAgo },
        },
        none: {
          endDate: { gt: ninetyDaysAgo },
        },
      },
    },
    include: {
      subscriptions: {
        orderBy: { endDate: "desc" },
        take: 1,
      },
    },
  });

  // Combine unique pharmacies
  const pharmacyMap = new Map();
  for (const p of [...candidatePharmacies, ...expiredSubsPharmacies]) {
    pharmacyMap.set(p.id, p);
  }

  for (const pharmacy of pharmacyMap.values()) {
    await prisma.$transaction(async (tx) => {
      // 1. Mark pharmacy as DEACTIVATED and set archivedAt
      await tx.pharmacy.update({
        where: { id: pharmacy.id },
        data: {
          status: PharmacyStatus.DEACTIVATED,
          archivedAt: now,
          deactivatedAt: pharmacy.deactivatedAt || now,
        },
      });

      // 2. Deactivate all users of this pharmacy
      await tx.user.updateMany({
        where: { pharmacyId: pharmacy.id },
        data: { status: UserStatus.INACTIVE },
      });

      // 3. Delete active sessions of these users
      const pharmacyUsers = await tx.user.findMany({
        where: { pharmacyId: pharmacy.id },
        select: { id: true },
      });
      const userIds = pharmacyUsers.map((u) => u.id);

      if (userIds.length > 0) {
        await tx.session.deleteMany({
          where: { userId: { in: userIds } },
        });
      }

      // 4. Record audit log
      await tx.auditLog.create({
        data: {
          pharmacyId: pharmacy.id,
          userName: "SYSTEM_CRON",
          userRole: Role.SUPER_ADMIN,
          action: "PHARMACY_ARCHIVED",
          entityType: "Pharmacy",
          entityId: pharmacy.id,
          reason: `Pharmacy data archived automatically after 90 days of expiration or passing archiveAt date (${pharmacy.name}).`,
        },
      });
    });

    archivedPharmaciesCount++;
  }

  return { archivedPharmaciesCount };
};
