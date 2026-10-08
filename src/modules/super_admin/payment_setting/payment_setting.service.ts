import { prisma } from "../../../lib/prisma";
import { Role } from "@prisma/client";
import AppError from "../../../errors/AppError";
import httpStatus from "http-status";
import { redisService } from "../../../utils/cache";

export interface IPaymentSettingPayload {
  bkash_number: string;
  bkash_account_type: string;
  payment_instructions: string;
  screenshot_max_mb?: string;
}

const CACHE_KEY = "payment-settings";

const getSettings = async () => {
  const cachedData = await redisService.get<any>(CACHE_KEY);
  if (cachedData) {
    return cachedData;
  }

  const settings = await prisma.paymentSetting.findFirst();
  
  if (settings) {
    await redisService.set(CACHE_KEY, settings, 86400); // cache for 1 day
  }
  
  return settings;
};

const createSettings = async (
  payload: IPaymentSettingPayload,
  user: { id: string; name: string; role: Role }
) => {
  const existingSettings = await prisma.paymentSetting.findFirst();
  if (existingSettings) {
    throw new AppError(httpStatus.BAD_REQUEST, "Payment settings already exist. Please update instead.");
  }

  const newSettings = await prisma.paymentSetting.create({
    data: {
      ...payload,
      updatedById: user.id,
    },
  });

  // Add audit log
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: "PAYMENT_SETTINGS_CREATED",
      entityType: "PaymentSetting",
      entityId: newSettings.id,
      newValue: newSettings as any,
    },
  });

  await redisService.delete(CACHE_KEY);
  await redisService.delete("payment-info:public");

  return newSettings;
};

const updateSettings = async (
  payload: Partial<IPaymentSettingPayload>,
  user: { id: string; name: string; role: Role }
) => {
  const existingSettings = await prisma.paymentSetting.findFirst();
  if (!existingSettings) {
    throw new AppError(httpStatus.NOT_FOUND, "Payment settings not found. Please create first.");
  }

  const updatedSettings = await prisma.paymentSetting.update({
    where: { id: existingSettings.id },
    data: {
      ...payload,
      updatedById: user.id,
    },
  });

  // Add audit log
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      action: "PAYMENT_SETTINGS_UPDATED",
      entityType: "PaymentSetting",
      entityId: updatedSettings.id,
      oldValue: existingSettings as any,
      newValue: updatedSettings as any,
    },
  });

  await redisService.delete(CACHE_KEY);
  await redisService.delete("payment-info:public");

  return updatedSettings;
};

export const PaymentSettingService = {
  getSettings,
  createSettings,
  updateSettings,
};
