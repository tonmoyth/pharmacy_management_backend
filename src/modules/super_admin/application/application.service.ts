import { ApplicationStatus, Prisma } from "@prisma/client";

import httpStatus from "http-status";
import { QueryBuilder } from "../../../utils/queryBuilder";
import { prisma } from "../../../lib/prisma";
import AppError from "../../../errors/AppError";
import { hashPassword } from "better-auth/crypto";
import { sendEmail } from "../../../utils/email";
import { Role } from "../../../../generated";
const getApplications = async (query: Record<string, unknown>) => {
  const applicationQuery = new QueryBuilder(prisma.application, query as any, {
    searchableFields: ["pharmacyName", "phone", "email", "ownerName"],
    filterableFields: ["status"],
  })
    .search()
    .filter()
    .sort()
    .paginate()
    .include({
      plan: {
        select: {
          id: true,
          name: true,
        },
      },
    });

  // Handle Date Range manually because queryBuilder might not support custom date range automatically if not in config
  if (query.startDate && query.endDate) {
    applicationQuery.where({
      createdAt: {
        gte: new Date(query.startDate as string),
        lte: new Date(query.endDate as string),
      },
    });
  } else if (query.startDate) {
    applicationQuery.where({
      createdAt: {
        gte: new Date(query.startDate as string),
      },
    });
  } else if (query.endDate) {
    applicationQuery.where({
      createdAt: {
        lte: new Date(query.endDate as string),
      },
    });
  }

  const result = await applicationQuery.execute();

  const dataWithExtras = result.data.map((app: any) => {
    let daysPending = 0;
    if (app.status === ApplicationStatus.PENDING) {
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - new Date(app.createdAt).getTime());
      daysPending = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }

    return {
      id: app.id,
      pharmacyName: app.pharmacyName,
      ownerName: app.ownerName,
      phone: app.phone,
      email: app.email,
      status: app.status,
      createdAt: app.createdAt,
      plan: app.plan,
      daysPending,
    };
  });

  return {
    meta: result.meta,
    data: dataWithExtras,
  };
};

const getApplicationDetails = async (id: string) => {
  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      plan: true,
      payments: {
        where: { type: "NEW" },
      },
    },
  });

  if (!application) {
    throw new AppError(httpStatus.NOT_FOUND, "Application not found");
  }

  return application;
};

const approveApplication = async (
  id: string,
  user: any,
  ip?: string,
  userAgent?: string
) => {
  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      payments: { where: { type: "NEW" }, take: 1 },
      plan: true,
    },
  });

  if (!application) {
    throw new AppError(httpStatus.NOT_FOUND, "Application not found");
  }

  if (application.status !== ApplicationStatus.PENDING) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Application is already ${application.status}`
    );
  }

  const payment = application.payments[0];
  if (!payment) {
    throw new AppError(httpStatus.BAD_REQUEST, "No new payment found for this application");
  }

  if (payment.status !== "PENDING") {
    throw new AppError(httpStatus.BAD_REQUEST, "Payment is not in pending state");
  }

  const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
  const hashedPassword = await hashPassword(tempPassword);

  const result = await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESS",
        verifiedById: user.id,
        verifiedAt: new Date(),
      },
    });

    const pharmacy = await tx.pharmacy.create({
      data: {
        name: application.pharmacyName,
        ownerName: application.ownerName,
        phone: application.phone,
        email: application.email,
        address: application.address,
        city: application.city,
        area: application.area,
        nidOrLicense: application.nidOrLicense,
        status: "ACTIVE",
      },
    });

    await tx.user.create({
      data: {
        email: application.email,
        name: application.ownerName,
        role: Role.PHARMACY_OWNER,
        pharmacyId: pharmacy.id,
        status: "ACTIVE",
        mustChangePassword: true,
        phone: application.phone,
        accounts: {
          create: {
            accountId: application.email,
            providerId: "credential",
            password: hashedPassword,
          },
        },
      },
    });

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + application.plan.durationDays);

    await tx.subscription.create({
      data: {
        pharmacyId: pharmacy.id,
        planId: application.plan.id,
        paymentId: payment.id,
        status: "ACTIVE",
        startDate,
        endDate,
      },
    });

    const updatedApplication = await tx.application.update({
      where: { id: application.id },
      data: {
        status: "APPROVED",
        pharmacyId: pharmacy.id,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });

    const docTypes = ["SALE", "SALE_RETURN", "PURCHASE_RETURN"] as const;
    await tx.documentCounter.createMany({
      data: docTypes.map((type) => ({
        pharmacyId: pharmacy.id,
        type,
        lastNumber: 0,
      })),
    });

    await tx.payment.update({
      where: { id: payment.id },
      data: { pharmacyId: pharmacy.id }
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        pharmacyId: pharmacy.id,
        action: "APPLICATION_APPROVED",
        entityType: "Application",
        entityId: application.id,
        reason: "Super Admin approved application",
        ip,
        userAgent,
      },
    });

    return {
      application: {
        id: updatedApplication.id,
        status: updatedApplication.status,
      },
      pharmacy: {
        id: pharmacy.id,
        status: pharmacy.status,
      },
    };
  });

  const emailSubject = "Pharmacy Application Approved";
  const emailText = `Hello ${application.ownerName},

Your application for "${application.pharmacyName}" has been approved.

Please log in using the following credentials:
Email: ${application.email}
Temporary Password: ${tempPassword}

You will be required to change your password upon first login.

Thank you,
Pharmacy Management System`;

  try {
    await sendEmail(application.email, emailSubject, emailText);
  } catch (error) {
    console.error("Failed to send approval email", error);
  }

  return result;
};

const rejectApplication = async (
  id: string,
  reason: string,
  user: any,
  ip?: string,
  userAgent?: string
) => {
  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      payments: { where: { type: "NEW" }, take: 1 },
    },
  });

  if (!application) {
    throw new AppError(httpStatus.NOT_FOUND, "Application not found");
  }

  if (application.status !== ApplicationStatus.PENDING) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Application is already ${application.status}`
    );
  }

  const payment = application.payments[0];
  if (!payment) {
    throw new AppError(httpStatus.BAD_REQUEST, "No new payment found for this application");
  }

  if (payment.status !== "PENDING") {
    throw new AppError(httpStatus.BAD_REQUEST, "Payment is not in pending state");
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        rejectReason: reason,
        verifiedById: user.id,
        verifiedAt: new Date(),
      },
    });

    const updatedApplication = await tx.application.update({
      where: { id: application.id },
      data: {
        status: "REJECTED",
        rejectReason: reason,
        reviewedById: user.id,
        reviewedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: "APPLICATION_REJECTED",
        entityType: "Application",
        entityId: application.id,
        reason: reason,
        ip,
        userAgent,
      },
    });

    return {
      application: {
        id: updatedApplication.id,
        status: updatedApplication.status,
      },
      payment: {
        id: updatedPayment.id,
        status: updatedPayment.status,
      },
    };
  });

  const emailSubject = "Pharmacy Application Rejected";
  const emailText = `Hello ${application.ownerName}, We regret to inform you that your application for "${application.pharmacyName}" has been rejected. Reason for rejection: ${reason} You are welcome to submit a new application once you have addressed the issues mentioned above. If you have any questions or need further clarification, please contact us on WhatsApp at: 01407641417 Thank you, Pharmacy Management System`;

  try {
    await sendEmail(application.email, emailSubject, emailText);
  } catch (error) {
    console.error("Failed to send rejection email", error);
  }

  return result;
};

export const AdminApplicationService = {
  getApplications,
  getApplicationDetails,
  approveApplication,
  rejectApplication,
};
