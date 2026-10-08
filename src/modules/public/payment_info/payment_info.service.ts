import { prisma } from "../../../lib/prisma";
import { redisService } from "../../../utils/cache";

const CACHE_KEY = "payment-info:public";

const getPaymentInfo = async () => {
  const cachedData = await redisService.get<any>(CACHE_KEY);
  if (cachedData) {
    return cachedData;
  }

  const settings = await prisma.paymentSetting.findFirst({
    select: {
      bkash_number: true,
      bkash_account_type: true,
      payment_instructions: true,
    },
  });

  if (settings) {
    await redisService.set(CACHE_KEY, settings, 86400); // cache for 1 day
  }

  return settings;
};

export const PublicPaymentInfoService = {
  getPaymentInfo,
};
