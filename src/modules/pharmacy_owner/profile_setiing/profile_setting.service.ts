import fs from "fs";
import httpStatus from "http-status";
import { Role } from "@prisma/client";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { cloudinaryService } from "../../../utils/cloudinary";

export interface IUpdateProfilePayload {
  phone?: string;
  address?: string;
  city?: string;
  area?: string;
  invoiceHeader?: string | null;
  invoiceFooter?: string | null;
}

export interface IUpdateSettingsPayload {
  maxDiscountPercent: number;
}

const getProfile = async (pharmacyId: string) => {
  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
    select: {
      id: true,
      name: true,
      ownerName: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      area: true,
      nidOrLicense: true,
      logoUrl: true,
      invoiceHeader: true,
      invoiceFooter: true,
      maxDiscountPercent: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!pharmacy) {
    throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  }

  return {
    ...pharmacy,
    logo: pharmacy.logoUrl,
    maxDiscountPercent: Number(pharmacy.maxDiscountPercent),
  };
};

const updateProfile = async (
  pharmacyId: string,
  payload: IUpdateProfilePayload,
  logoFile?: Express.Multer.File,
  user?: { id: string; name: string; role: Role },
  ip?: string,
  userAgent?: string
) => {
  const existingPharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
  });

  if (!existingPharmacy) {
    if (logoFile && fs.existsSync(logoFile.path)) {
      fs.unlinkSync(logoFile.path);
    }
    throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  }

  let uploadResult: { url: string; public_id: string } | null = null;

  if (logoFile) {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/jpg",
      "image/svg+xml",
    ];

    if (!allowedMimeTypes.includes(logoFile.mimetype)) {
      if (fs.existsSync(logoFile.path)) {
        fs.unlinkSync(logoFile.path);
      }
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Invalid file format. Only JPEG, PNG, WEBP, and SVG images are allowed for logo"
      );
    }

    const maxSize = 5 * 1024 * 1024; // 5MB
    if (logoFile.size > maxSize) {
      if (fs.existsSync(logoFile.path)) {
        fs.unlinkSync(logoFile.path);
      }
      throw new AppError(httpStatus.BAD_REQUEST, "Logo file size cannot exceed 5MB");
    }

    uploadResult = await cloudinaryService.uploadToCloudinary(
      logoFile.path,
      "pharmacy-saas/logos"
    );

    if (!uploadResult) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "Failed to upload logo image to storage"
      );
    }
  }

  const updateData: Record<string, any> = {};
  if (payload.phone !== undefined) updateData.phone = payload.phone;
  if (payload.address !== undefined) updateData.address = payload.address;
  if (payload.city !== undefined) updateData.city = payload.city;
  if (payload.area !== undefined) updateData.area = payload.area;
  if (payload.invoiceHeader !== undefined) updateData.invoiceHeader = payload.invoiceHeader;
  if (payload.invoiceFooter !== undefined) updateData.invoiceFooter = payload.invoiceFooter;
  if (uploadResult?.url) updateData.logoUrl = uploadResult.url;

  const changedFields: string[] = [];
  const oldValue: Record<string, any> = {};
  const newValue: Record<string, any> = {};

  for (const [key, val] of Object.entries(updateData)) {
    const prev = (existingPharmacy as any)[key];
    if (prev !== val) {
      changedFields.push(key);
      oldValue[key] = prev;
      newValue[key] = val;
    }
  }

  let updatedPharmacy;
  try {
    updatedPharmacy = await prisma.$transaction(async (tx) => {
      const updated = await tx.pharmacy.update({
        where: { id: pharmacyId },
        data: updateData,
        select: {
          id: true,
          name: true,
          ownerName: true,
          phone: true,
          email: true,
          address: true,
          city: true,
          area: true,
          nidOrLicense: true,
          logoUrl: true,
          invoiceHeader: true,
          invoiceFooter: true,
          maxDiscountPercent: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (changedFields.length > 0 && user) {
        await tx.auditLog.create({
          data: {
            pharmacyId: existingPharmacy.id,
            userId: user.id,
            userName: user.name,
            userRole: user.role,
            action: "PHARMACY_PROFILE_UPDATED",
            entityType: "Pharmacy",
            entityId: existingPharmacy.id,
            oldValue,
            newValue,
            reason: `Pharmacy profile updated: ${changedFields.join(", ")}`,
            ip,
            userAgent,
          },
        });
      }

      return updated;
    });
  } catch (error) {
    if (uploadResult?.public_id) {
      await cloudinaryService.deleteFromCloudinary(uploadResult.public_id);
    }
    throw error;
  }

  if (uploadResult?.url && existingPharmacy.logoUrl) {
    cloudinaryService.deleteFromCloudinary(existingPharmacy.logoUrl).catch((err) => {
      console.error("Failed to delete previous logo from Cloudinary:", err);
    });
  }

  return {
    ...updatedPharmacy,
    logo: updatedPharmacy.logoUrl,
    maxDiscountPercent: Number(updatedPharmacy.maxDiscountPercent),
  };
};

const updateSettings = async (
  pharmacyId: string,
  payload: IUpdateSettingsPayload,
  user?: { id: string; name: string; role: Role },
  ip?: string,
  userAgent?: string
) => {
  const existingPharmacy = await prisma.pharmacy.findUnique({
    where: { id: pharmacyId },
  });

  if (!existingPharmacy) {
    throw new AppError(httpStatus.NOT_FOUND, "Pharmacy not found");
  }

  const previousValue = Number(existingPharmacy.maxDiscountPercent);
  const newValue = Number(payload.maxDiscountPercent);

  const updatedPharmacy = await prisma.$transaction(async (tx) => {
    const updated = await tx.pharmacy.update({
      where: { id: pharmacyId },
      data: {
        maxDiscountPercent: payload.maxDiscountPercent,
      },
      select: {
        id: true,
        name: true,
        ownerName: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        area: true,
        nidOrLicense: true,
        logoUrl: true,
        invoiceHeader: true,
        invoiceFooter: true,
        maxDiscountPercent: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (user) {
      await tx.auditLog.create({
        data: {
          pharmacyId: existingPharmacy.id,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "PHARMACY_SETTINGS_UPDATED",
          entityType: "Pharmacy",
          entityId: existingPharmacy.id,
          oldValue: { maxDiscountPercent: previousValue },
          newValue: { maxDiscountPercent: newValue },
          reason: `Updated max discount percent from ${previousValue}% to ${newValue}%`,
          ip,
          userAgent,
        },
      });
    }

    return updated;
  });

  return {
    ...updatedPharmacy,
    logo: updatedPharmacy.logoUrl,
    maxDiscountPercent: Number(updatedPharmacy.maxDiscountPercent),
  };
};

export const ProfileSettingService = {
  getProfile,
  updateProfile,
  updateSettings,
};
