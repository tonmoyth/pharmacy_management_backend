import { PharmacyStatus, Role, SubscriptionStatus } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/queryBuilder";

const getPharmacies = async (query: Record<string, unknown>) => {
  const pharmacyQuery = new QueryBuilder(prisma.pharmacy, query as any, {
    searchableFields: ["name", "ownerName", "email", "phone"],
    filterableFields: ["status"],
  })
    .search()
    .filter()
    .sort()
    .paginate()
    .include({
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          plan: {
            select: { name: true }
          }
        }
      }
    });
    
  if (query.subscriptionStatus) {
    pharmacyQuery.where({
      subscriptions: {
        some: {
          status: query.subscriptionStatus as any
        }
      }
    });
  }

  if (query.expiringSoon === 'true') {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    pharmacyQuery.where({
      subscriptions: {
        some: {
          status: 'ACTIVE',
          endDate: {
            lte: nextWeek
          }
        }
      }
    });
  }

  const result = await pharmacyQuery.execute();

  const data = result.data.map((pharmacy: any) => {
    const currentSub = pharmacy.subscriptions[0];
    return {
      id: pharmacy.id,
      name: pharmacy.name,
      ownerName: pharmacy.ownerName,
      phone: pharmacy.phone,
      email: pharmacy.email,
      address: pharmacy.address,
      status: pharmacy.status,
      createdAt: pharmacy.createdAt,
      currentPlan: currentSub?.plan?.name || null,
      subscriptionStatus: currentSub?.status || null,
      subscriptionExpiry: currentSub?.endDate || null,
    };
  });

  return { meta: result.meta, data };
};

const getPharmacyDetails = async (id: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id },
    include: {
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { plan: true }
      },
      users: {
        where: { role: Role.PHARMACY_OWNER },
        select: {
          name: true,
          email: true,
          lastLoginAt: true
        }
      },
      _count: {
        select: {
          users: {
            where: {
              role: { in: [Role.CASHIER, Role.STAFF] }
            }
          }
        }
      }
    }
  });

  if (!pharmacy) {
    throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  }

  return {
    id: pharmacy.id,
    name: pharmacy.name,
    ownerName: pharmacy.ownerName,
    phone: pharmacy.phone,
    email: pharmacy.email,
    address: pharmacy.address,
    city: pharmacy.city,
    area: pharmacy.area,
    nidOrLicense: pharmacy.nidOrLicense,
    logoUrl: pharmacy.logoUrl,
    status: pharmacy.status,
    suspendedReason: pharmacy.suspendedReason,
    createdAt: pharmacy.createdAt,
    currentSubscription: pharmacy.subscriptions[0] || null,
    ownerAccount: pharmacy.users[0] || null,
    staffCount: pharmacy._count.users
  };
};

const activatePharmacy = async (id: string, adminUser: any, ip?: string, userAgent?: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({ where: { id } });
  if (!pharmacy) throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  if (pharmacy.status === PharmacyStatus.ACTIVE) throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy is already active");

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPharmacy = await tx.pharmacy.update({
      where: { id },
      data: { status: PharmacyStatus.ACTIVE, suspendedReason: null, suspendedAt: null }
    });

    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        userName: adminUser.name,
        userRole: adminUser.role,
        pharmacyId: id,
        action: "PHARMACY_ACTIVATED",
        entityType: "Pharmacy",
        entityId: id,
        reason: "Super Admin activated pharmacy",
        ip,
        userAgent
      }
    });

    return updatedPharmacy;
  });

  return updated;
};

const suspendPharmacy = async (id: string, reason: string, adminUser: any, ip?: string, userAgent?: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({ where: { id } });
  if (!pharmacy) throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  if (pharmacy.status === PharmacyStatus.SUSPENDED) throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy is already suspended");

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPharmacy = await tx.pharmacy.update({
      where: { id },
      data: { status: PharmacyStatus.SUSPENDED, suspendedReason: reason, suspendedAt: new Date() }
    });

    const users = await tx.user.findMany({ where: { pharmacyId: id }, select: { id: true } });
    const userIds = users.map(u => u.id);

    if (userIds.length > 0) {
      await tx.session.deleteMany({ where: { userId: { in: userIds } } });
      await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    }

    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        userName: adminUser.name,
        userRole: adminUser.role,
        pharmacyId: id,
        action: "PHARMACY_SUSPENDED",
        entityType: "Pharmacy",
        entityId: id,
        reason,
        ip,
        userAgent
      }
    });

    return updatedPharmacy;
  });

  return updated;
};

const deactivatePharmacy = async (id: string, reason: string, adminUser: any, ip?: string, userAgent?: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({ where: { id } });
  if (!pharmacy) throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  if (pharmacy.status === PharmacyStatus.DEACTIVATED) throw new AppError(httpStatus.BAD_REQUEST, "Pharmacy is already deactivated");

  const archiveAt = new Date();
  archiveAt.setDate(archiveAt.getDate() + 90);

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPharmacy = await tx.pharmacy.update({
      where: { id },
      data: { 
        status: PharmacyStatus.DEACTIVATED, 
        deactivatedAt: new Date(),
        archiveAt
      }
    });

    const users = await tx.user.findMany({ where: { pharmacyId: id }, select: { id: true } });
    const userIds = users.map(u => u.id);

    if (userIds.length > 0) {
      await tx.session.deleteMany({ where: { userId: { in: userIds } } });
      await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
    }

    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        userName: adminUser.name,
        userRole: adminUser.role,
        pharmacyId: id,
        action: "PHARMACY_DEACTIVATED",
        entityType: "Pharmacy",
        entityId: id,
        reason,
        ip,
        userAgent
      }
    });

    return updatedPharmacy;
  });

  return updated;
};

const getPharmacySubscriptions = async (id: string) => {
  const subscriptions = await prisma.subscription.findMany({
    where: { pharmacyId: id },
    include: {
      plan: true,
      payment: true
    },
    orderBy: { createdAt: "desc" }
  });
  return subscriptions;
};

const getPharmacyPayments = async (id: string) => {
  const payments = await prisma.payment.findMany({
    where: { pharmacyId: id },
    include: {
      plan: true,
      verifiedBy: {
        select: { id: true, name: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });
  return payments;
};

export const AdminPharmacyService = {
  getPharmacies,
  getPharmacyDetails,
  activatePharmacy,
  suspendPharmacy,
  deactivatePharmacy,
  getPharmacySubscriptions,
  getPharmacyPayments,
};
