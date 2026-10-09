import { prisma } from "../../../lib/prisma";
import { PaymentStatus, SubscriptionStatus } from "@prisma/client";

const getRevenueReport = async (query: Record<string, unknown>) => {
  const from = query.from ? new Date(query.from as string) : new Date(new Date().setFullYear(new Date().getFullYear() - 1));
  const to = query.to ? new Date(query.to as string) : new Date();
  const groupBy = query.groupBy === "month" ? "month" : "day";

  const payments = await prisma.payment.findMany({
    where: {
      status: { in: [PaymentStatus.SUCCESS, PaymentStatus.REFUNDED] },
      paidAt: { gte: from, lte: to }
    },
    select: { amount: true, paidAt: true, status: true }
  });

  const groupedData: Record<string, { revenue: number, refunds: number, net: number }> = {};

  payments.forEach(payment => {
    const date = new Date(payment.paidAt);
    let key = "";
    if (groupBy === "month") {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    } else {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    if (!groupedData[key]) {
      groupedData[key] = { revenue: 0, refunds: 0, net: 0 };
    }

    const amt = Number(payment.amount);
    if (payment.status === PaymentStatus.SUCCESS) {
      groupedData[key].revenue += amt;
      groupedData[key].net += amt;
    } else if (payment.status === PaymentStatus.REFUNDED) {
      groupedData[key].refunds += amt;
      groupedData[key].net -= amt;
    }
  });

  return Object.entries(groupedData)
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));
};

const getSubscriptionsReport = async () => {
  const statusCounts = await prisma.subscription.groupBy({
    by: ["status"],
    _count: { id: true }
  });

  const planCounts = await prisma.subscription.groupBy({
    by: ["planId"],
    _count: { id: true }
  });

  const plans = await prisma.plan.findMany({ select: { id: true, name: true } });
  const planMap = new Map(plans.map(p => [p.id, p.name]));

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  
  const upcomingExpiries = await prisma.subscription.count({
    where: { status: SubscriptionStatus.ACTIVE, endDate: { lte: nextWeek } }
  });

  const renewalCount = await prisma.payment.count({
    where: { type: "RENEWAL", status: PaymentStatus.SUCCESS }
  });

  return {
    byStatus: statusCounts.map(s => ({ status: s.status, count: s._count.id })),
    byPlan: planCounts.map(p => ({ planName: planMap.get(p.planId) || "Unknown", count: p._count.id })),
    upcomingExpiries,
    totalRenewals: renewalCount
  };
};

const getPharmacyGrowthReport = async (query: Record<string, unknown>) => {
  const pharmacies = await prisma.pharmacy.findMany({
    select: { createdAt: true }
  });

  const groupedData: Record<string, number> = {};
  
  pharmacies.forEach(p => {
    const date = new Date(p.createdAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; // default month grouping
    groupedData[key] = (groupedData[key] || 0) + 1;
  });

  const sortedKeys = Object.keys(groupedData).sort();
  
  let cumulative = 0;
  const growth = sortedKeys.map(key => {
    cumulative += groupedData[key];
    return {
      period: key,
      newPharmacies: groupedData[key],
      cumulativeTotal: cumulative
    };
  });

  return growth;
};

export const AdminReportsService = {
  getRevenueReport,
  getSubscriptionsReport,
  getPharmacyGrowthReport,
};
