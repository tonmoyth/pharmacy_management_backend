import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/queryBuilder";
import { sendEmail } from "../../../utils/email";
import { PaymentStatus, PaymentType, SubscriptionStatus } from "@prisma/client";

const getPayments = async (query: Record<string, unknown>) => {
  const paymentQuery = new QueryBuilder(prisma.payment, query as any, {
    searchableFields: ["transactionId", "senderNumber"],
    filterableFields: ["status", "type", "pharmacyId"],
  })
    .search()
    .filter()
    .sort()
    .paginate()
    .include({
      pharmacy: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
        },
      },
      plan: {
        select: {
          id: true,
          name: true,
          price: true,
        },
      },
      application: {
        select: {
          id: true,
          pharmacyName: true,
        }
      }
    });

  if (query.startDate && query.endDate) {
    paymentQuery.where({
      createdAt: {
        gte: new Date(query.startDate as string),
        lte: new Date(query.endDate as string),
      },
    });
  } else if (query.startDate) {
    paymentQuery.where({
      createdAt: {
        gte: new Date(query.startDate as string),
      },
    });
  } else if (query.endDate) {
    paymentQuery.where({
      createdAt: {
        lte: new Date(query.endDate as string),
      },
    });
  }

  const result = await paymentQuery.execute();
  return result;
};

const getPaymentDetails = async (id: string) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      pharmacy: true,
      plan: true,
      verifiedBy: {
        select: { id: true, name: true, email: true },
      },
      application: true,
      subscription: true,
    },
  });

  if (!payment) {
    throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
  }

  return payment;
};

const approveRenewalPayment = async (
  id: string,
  adminUser: any,
  ip?: string,
  userAgent?: string
) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      plan: true,
      pharmacy: {
        include: {
          subscriptions: {
            where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.EXPIRING_SOON] } },
            orderBy: { endDate: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!payment) {
    throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
  }

  if (payment.type !== PaymentType.RENEWAL) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Only RENEWAL payments can be approved through this endpoint. NEW payments must be handled via application approval."
    );
  }

  if (payment.status !== PaymentStatus.PENDING) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Payment is already in ${payment.status} state`
    );
  }

  if (!payment.pharmacyId) {
    throw new AppError(httpStatus.BAD_REQUEST, "Payment is missing associated pharmacy ID");
  }

  // Check if transaction ID is already used by a successful payment
  const existingSuccess = await prisma.payment.findFirst({
    where: {
      transactionId: payment.transactionId,
      status: PaymentStatus.SUCCESS,
    },
  });

  if (existingSuccess) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Transaction ID has already been used in a successful payment"
    );
  }

  // Verify amount matches plan price
  if (Number(payment.amount) < Number(payment.plan.price)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Payment amount (${payment.amount}) is less than the plan price (${payment.plan.price})`
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Determine start date based on current subscription
    let startDate = new Date();
    const currentSub = payment.pharmacy?.subscriptions[0];
    
    if (currentSub && currentSub.endDate > startDate) {
      startDate = new Date(currentSub.endDate);
    }

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + payment.plan.durationDays);

    // Update payment
    const updatedPayment = await tx.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.SUCCESS,
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
      },
    });

    // Create subscription
    const newSubscription = await tx.subscription.create({
      data: {
        pharmacyId: payment.pharmacyId!,
        planId: payment.planId,
        paymentId: payment.id,
        status: SubscriptionStatus.ACTIVE,
        startDate,
        endDate,
      },
    });

    // Write audit log
    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        userName: adminUser.name,
        userRole: adminUser.role,
        pharmacyId: payment.pharmacyId,
        action: "PAYMENT_APPROVED",
        entityType: "Payment",
        entityId: payment.id,
        reason: "Super Admin approved renewal payment",
        ip,
        userAgent,
      },
    });

    return { payment: updatedPayment, subscription: newSubscription };
  });

  // Send confirmation email
  if (payment.pharmacy?.email) {
    const emailSubject = "Payment Approved and Subscription Renewed";
    const emailText = `Hello ${payment.pharmacy.ownerName},\n\nYour renewal payment of ${payment.amount} BDT for the "${payment.plan.name}" plan has been successfully verified and approved.\nYour subscription is now active.\n\nThank you,\nPharmacy Management System`;
    
    try {
      await sendEmail(payment.pharmacy.email, emailSubject, emailText);
    } catch (error) {
      console.error("Failed to send payment approval email", error);
    }
  }

  return result;
};

const rejectRenewalPayment = async (
  id: string,
  reason: string,
  adminUser: any,
  ip?: string,
  userAgent?: string
) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { pharmacy: true },
  });

  if (!payment) {
    throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
  }

  if (payment.type !== PaymentType.RENEWAL) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Only RENEWAL payments can be rejected through this endpoint."
    );
  }

  if (payment.status !== PaymentStatus.PENDING) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Payment is already in ${payment.status} state`
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.FAILED,
        rejectReason: reason,
        verifiedById: adminUser.id,
        verifiedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        userName: adminUser.name,
        userRole: adminUser.role,
        pharmacyId: payment.pharmacyId,
        action: "PAYMENT_REJECTED",
        entityType: "Payment",
        entityId: payment.id,
        reason: reason,
        ip,
        userAgent,
      },
    });

    return updatedPayment;
  });

  // Send rejection email
  if (payment.pharmacy?.email) {
    const emailSubject = "Renewal Payment Rejected";
    const emailText = `Hello ${payment.pharmacy.ownerName},\n\nWe regret to inform you that your renewal payment (Transaction ID: ${payment.transactionId}) has been rejected.\n\nReason: ${reason}\n\nPlease submit a new payment with a valid transaction ID. If you have any questions, please contact support.\n\nThank you,\nPharmacy Management System`;
    
    try {
      await sendEmail(payment.pharmacy.email, emailSubject, emailText);
    } catch (error) {
      console.error("Failed to send payment rejection email", error);
    }
  }

  return result;
};

const refundPayment = async (
  id: string,
  note: string,
  adminUser: any,
  ip?: string,
  userAgent?: string
) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { subscription: true },
  });

  if (!payment) {
    throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
  }

  if (payment.status !== PaymentStatus.SUCCESS) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Only SUCCESS payments can be refunded."
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.update({
      where: { id },
      data: {
        status: PaymentStatus.REFUNDED,
        refundNote: note,
        refundedAt: new Date(),
      },
    });

    if (payment.subscription) {
      await tx.subscription.update({
        where: { id: payment.subscription.id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        userName: adminUser.name,
        userRole: adminUser.role,
        pharmacyId: payment.pharmacyId,
        action: "PAYMENT_REFUNDED",
        entityType: "Payment",
        entityId: payment.id,
        reason: note,
        ip,
        userAgent,
      },
    });

    return updatedPayment;
  });

  return result;
};

export const AdminPaymentManagementService = {
  getPayments,
  getPaymentDetails,
  approveRenewalPayment,
  rejectRenewalPayment,
  refundPayment,
};
