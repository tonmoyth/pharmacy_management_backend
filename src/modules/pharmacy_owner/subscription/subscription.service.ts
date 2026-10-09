import { PaymentStatus, PaymentType, NotificationType } from "@prisma/client";
import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/queryBuilder";

import { cloudinaryService } from "../../../utils/cloudinary";

const getSubscription = async (pharmacyId: string) => {
  const subscription = await prisma.subscription.findFirst({
    where: { pharmacyId },
    orderBy: { createdAt: "desc" },
    include: { plan: true }
  });

  if (!subscription) {
    return null;
  }

  const today = new Date();
  const endDate = new Date(subscription.endDate);
  const diffTime = endDate.getTime() - today.getTime();
  const daysLeft = diffTime > 0 ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 0;

  const pendingPayment = await prisma.payment.findFirst({
    where: {
      pharmacyId,
      type: PaymentType.RENEWAL,
      status: PaymentStatus.PENDING
    }
  });

  return {
    ...subscription,
    daysLeft,
    renewalPending: !!pendingPayment
  };
};

const renewSubscription = async (pharmacyId: string, payload: any, screenshotPath?: string) => {
  const plan = await prisma.plan.findUnique({ where: { id: payload.planId } });
  if (!plan || plan.status !== "ACTIVE") {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid or inactive plan selected");
  }

  if (Number(payload.amount) !== Number(plan.price)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Submitted amount does not match plan price");
  }

  const existingPayment = await prisma.payment.findFirst({
    where: {
      transactionId: payload.transactionId,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.SUCCESS] }
    }
  });
  if (existingPayment) {
    throw new AppError(httpStatus.BAD_REQUEST, "Transaction ID already used");
  }

  const pendingRenewal = await prisma.payment.findFirst({
    where: {
      pharmacyId,
      type: PaymentType.RENEWAL,
      status: PaymentStatus.PENDING
    }
  });
  if (pendingRenewal) {
    throw new AppError(httpStatus.BAD_REQUEST, "You already have a pending renewal payment");
  }

  let uploadedScreenshotUrl: string | undefined;

  if (screenshotPath) {
    const uploadResult = await cloudinaryService.uploadToCloudinary(screenshotPath, "pharmacy-saas/payments");
    if (uploadResult) {
      uploadedScreenshotUrl = uploadResult.url;
    }
  }

  const payment = await prisma.payment.create({
    data: {
      type: PaymentType.RENEWAL,
      pharmacyId,
      planId: payload.planId,
      amount: payload.amount,
      transactionId: payload.transactionId,
      senderNumber: payload.senderNumber,
      paidAt: new Date(payload.paidAt),
      screenshotPath: uploadedScreenshotUrl,
      status: PaymentStatus.PENDING,
    }
  });

  // Notify Super Admin (pharmacyId = null means it is for super admins)
  await prisma.notification.create({
    data: {
      pharmacyId: null,
      type: NotificationType.PENDING_PAYMENT,
      title: "New Renewal Payment",
      message: `A new renewal payment has been submitted. Transaction ID: ${payload.transactionId}`,
      isRead: false,
      refType: "Payment",
      refId: payment.id
    }
  });

  return payment;
};

const getPayments = async (pharmacyId: string, query: Record<string, unknown>) => {
  query.pharmacyId = pharmacyId;

  const paymentsQuery = new QueryBuilder(prisma.payment, query as any, {
    searchableFields: ["transactionId", "senderNumber"],
    filterableFields: ["status", "type", "pharmacyId"],
  })
    .search()
    .filter()
    .sort()
    .paginate()
    .include({ plan: true });

  return await paymentsQuery.execute();
};

const getPaymentReceipt = async (pharmacyId: string, paymentId: string) => {
  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      pharmacyId,
      status: PaymentStatus.SUCCESS
    },
    include: {
      plan: true,
      pharmacy: true
    }
  });

  if (!payment) {
    throw new AppError(httpStatus.NOT_FOUND, "Payment receipt not found or not accessible");
  }

  return {
    receiptNumber: payment.id.slice(-6).toUpperCase(),
    pharmacyName: payment.pharmacy?.name,
    planName: payment.plan.name,
    amount: payment.amount,
    transactionId: payment.transactionId,
    paymentDate: payment.paidAt,
    paymentMethod: payment.method,
  };
};

export const SubscriptionService = {
  getSubscription,
  renewSubscription,
  getPayments,
  getPaymentReceipt
};
