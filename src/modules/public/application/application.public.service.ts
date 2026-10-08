import { ApplicationStatus, PaymentStatus, PaymentType, NotificationType, PlanStatus } from "@prisma/client";

import httpStatus from "http-status";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { cloudinaryService } from "../../../utils/cloudinary";


export interface ICreatePublicApplicationPayload {
  pharmacyName: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  area: string;
  planId: string;
  termsAccepted: boolean;
  transactionId: string;
  senderNumber: string;
  amount: number;
  paidAt: Date;
}

const createApplication = async (
  payload: ICreatePublicApplicationPayload,
  files: {
    screenshot?: Express.Multer.File;
    nidOrLicense?: Express.Multer.File;
  }
) => {
  // 1. Validate Plan
  const plan = await prisma.plan.findUnique({
    where: { id: payload.planId },
  });

  if (!plan) {
    throw new AppError(httpStatus.NOT_FOUND, "Selected plan does not exist");
  }

  if (plan.status !== PlanStatus.ACTIVE) {
    throw new AppError(httpStatus.BAD_REQUEST, "Selected plan is currently inactive or unavailable");
  }

  if (Number(plan.price) !== Number(payload.amount)) {
    throw new AppError(httpStatus.BAD_REQUEST, `Amount mismatch. The current price for this plan is ${plan.price}`);
  }

  // 2. Check for Duplicate Transaction ID
  const existingPayment = await prisma.payment.findFirst({
    where: {
      transactionId: payload.transactionId,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.SUCCESS] },
    },
  });

  if (existingPayment) {
    throw new AppError(httpStatus.CONFLICT, "This transaction ID has already been used");
  }

  // 3. Check for Duplicate Phone/Email
  // In User
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: payload.email }, { phone: payload.phone }],
    },
  });

  if (existingUser) {
    throw new AppError(httpStatus.CONFLICT, "A user with this email or phone already exists");
  }

  // In Application (PENDING, APPROVED, ACTIVE)
  const existingApp = await prisma.application.findFirst({
    where: {
      OR: [{ email: payload.email }, { phone: payload.phone }],
      status: { in: [ApplicationStatus.PENDING, ApplicationStatus.APPROVED, ApplicationStatus.ACTIVE] },
    },
  });

  if (existingApp) {
    throw new AppError(httpStatus.CONFLICT, "An active or pending application with this email or phone already exists");
  }

  // 4. Upload Files to Cloudinary
  let screenshotUrl: string | null = null;
  let screenshotPublicId: string | null = null;

  let nidOrLicenseUrl: string | null = null;
  let nidOrLicensePublicId: string | null = null;

  try {
    if (files.screenshot) {
      const uploadResult = await cloudinaryService.uploadToCloudinary(files.screenshot.path);
      if (!uploadResult) {
        throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "Failed to upload screenshot to Cloudinary");
      }
      screenshotUrl = uploadResult.url;
      screenshotPublicId = uploadResult.public_id;
    }

    if (files.nidOrLicense) {
      const uploadResult = await cloudinaryService.uploadToCloudinary(files.nidOrLicense.path);
      if (!uploadResult) {
        throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "Failed to upload NID or License to Cloudinary");
      }
      nidOrLicenseUrl = uploadResult.url;
      nidOrLicensePublicId = uploadResult.public_id;
    }

    // 5. Prisma Transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create Application
      const application = await tx.application.create({
        data: {
          pharmacyName: payload.pharmacyName,
          ownerName: payload.ownerName,
          phone: payload.phone,
          email: payload.email,
          address: payload.address,
          city: payload.city,
          area: payload.area,
          planId: payload.planId,
          termsAcceptedAt: new Date(),
          status: ApplicationStatus.PENDING,
          nidOrLicense: nidOrLicenseUrl, // Assuming the URL is stored here
        },
      });

      // Create Payment
      const payment = await tx.payment.create({
        data: {
          type: PaymentType.NEW,
          applicationId: application.id,
          planId: payload.planId,
          amount: payload.amount,
          transactionId: payload.transactionId,
          senderNumber: payload.senderNumber,
          paidAt: payload.paidAt,
          screenshotPath: screenshotUrl,
          status: PaymentStatus.PENDING,
        },
      });

      // Create Notifications for Super Admin (pharmacyId is null for Super Admin notifications)
      await tx.notification.createMany({
        data: [
          {
            type: NotificationType.NEW_APPLICATION,
            title: "New Application Received",
            message: `A new application has been submitted by ${payload.ownerName} for ${payload.pharmacyName}.`,
            refType: "Application",
            refId: application.id,
          },
          {
            type: NotificationType.PENDING_PAYMENT,
            title: "Pending Payment Verification",
            message: `A payment of ${payload.amount} is waiting for verification for application ${application.id}.`,
            refType: "Payment",
            refId: payment.id,
          },
        ],
      });

      return application;
    });

    return result;
  } catch (error) {
    // 6. Rollback / Cleanup Cloudinary
    if (screenshotPublicId) {
      await cloudinaryService.deleteFromCloudinary(screenshotPublicId);
    }
    if (nidOrLicensePublicId) {
      await cloudinaryService.deleteFromCloudinary(nidOrLicensePublicId);
    }

    throw error;
  }
};

export const PublicApplicationService = {
  createApplication,
};
