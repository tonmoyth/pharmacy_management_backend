import { PlanStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { redisService } from "../../../utils/cache";

const getActivePlans = async () => {
  const CACHE_KEY = "subscription-plans:public:active";
  const cachedData = await redisService.get<any>(CACHE_KEY);
  if (cachedData) {
    return cachedData;
  }

  const result = await prisma.plan.findMany({
    where: { status: PlanStatus.ACTIVE },
    select: {
      id: true,
      name: true,
      durationDays: true,
      price: true,
      features: true,
    },
    orderBy: { sortOrder: "asc" },
  });

  await redisService.set(CACHE_KEY, result, 86400); // cache for 1 day

  return result;
};

export const PublicPlanService = {
  getActivePlans,
};
