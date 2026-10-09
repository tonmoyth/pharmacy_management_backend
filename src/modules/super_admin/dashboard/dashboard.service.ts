import { prisma } from "../../../lib/prisma";
import { PaymentStatus, PharmacyStatus, SubscriptionStatus, ApplicationStatus } from "@prisma/client";

const getDashboardStats = async () => {
  const [
    totalPharmacies,
    activePharmacies,
    suspendedPharmacies,
    deactivatedPharmacies,
    pendingApplications,
    activeSubscriptions,
    expiredSubscriptions,
    expiringSubscriptions,
    pendingPayments,
  ] = await Promise.all([
    prisma.pharmacy.count(),
    prisma.pharmacy.count({ where: { status: PharmacyStatus.ACTIVE } }),
    prisma.pharmacy.count({ where: { status: PharmacyStatus.SUSPENDED } }),
    prisma.pharmacy.count({ where: { status: PharmacyStatus.DEACTIVATED } }),
    prisma.application.count({ where: { status: ApplicationStatus.PENDING } }),
    prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
    prisma.subscription.count({ where: { status: SubscriptionStatus.EXPIRED } }),
    prisma.subscription.count({ where: { status: SubscriptionStatus.EXPIRING_SOON } }),
    prisma.payment.count({ where: { status: PaymentStatus.PENDING } }),
  ]);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const totalRevenueResult = await prisma.payment.aggregate({
    where: { status: PaymentStatus.SUCCESS },
    _sum: { amount: true },
  });

  const currentMonthRevenueResult = await prisma.payment.aggregate({
    where: { status: PaymentStatus.SUCCESS, paidAt: { gte: startOfMonth } },
    _sum: { amount: true },
  });

  const totalRefundedResult = await prisma.payment.aggregate({
    where: { status: PaymentStatus.REFUNDED },
    _sum: { amount: true },
  });

  const totalRevenue = (Number(totalRevenueResult._sum.amount) || 0) - (Number(totalRefundedResult._sum.amount) || 0);
  const currentMonthRevenue = Number(currentMonthRevenueResult._sum.amount) || 0;

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const subscriptionsExpiringIn7Days = await prisma.subscription.count({
    where: {
      status: SubscriptionStatus.ACTIVE,
      endDate: { lte: nextWeek },
    }
  });

  const recentPayments = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { pharmacy: { select: { name: true } }, plan: { select: { name: true } } }
  });

  const recentApplications = await prisma.application.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { plan: { select: { name: true } } }
  });

  const recentActivities = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return {
    pharmacies: {
      total: totalPharmacies,
      active: activePharmacies,
      suspended: suspendedPharmacies,
      deactivated: deactivatedPharmacies,
    },
    applications: {
      pending: pendingApplications,
    },
    subscriptions: {
      active: activeSubscriptions,
      expired: expiredSubscriptions,
      expiring: expiringSubscriptions,
    },
    revenue: {
      total: totalRevenue,
      currentMonth: currentMonthRevenue,
    },
    alerts: {
      newApplications: pendingApplications,
      pendingPayments,
      subscriptionsExpiringIn7Days,
    },
    recent: {
      payments: recentPayments,
      applications: recentApplications,
      activities: recentActivities,
    }
  };
};

export const AdminDashboardService = {
  getDashboardStats,
};
