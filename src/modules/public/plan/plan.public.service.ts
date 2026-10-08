import { PlanStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";

const getActivePlans = async () => {
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

  return result;
};

export const PublicPlanService = {
  getActivePlans,
};
