import { Plan, PlanStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/queryBuilder";
import AppError from "../../../errors/AppError";
import httpStatus from "http-status";
import { redisService } from "../../../utils/cache";

export interface ICreatePlanPayload {
  name: string;
  durationDays: number;
  price: number;
  features?: string[];
  status?: PlanStatus;
  sortOrder?: number;
}

const createPlan = async (payload: ICreatePlanPayload) => {
  const result = await prisma.plan.create({
    data: payload,
  });

  await redisService.deleteByPattern("subscription-plans*");

  return result;
};

const getAllPlans = async (query: Record<string, unknown>) => {
  const CACHE_KEY = `subscription-plans:admin:all:${JSON.stringify(query)}`;
  const cachedData = await redisService.get<any>(CACHE_KEY);
  if (cachedData) {
    return cachedData;
  }

  const queryBuilder = new QueryBuilder(prisma.plan as any, query as any, {
    searchableFields: ["name", "features"],
  });

  const result = await queryBuilder
    .search()
    .filter()
    .sort()
    .paginate()
    .fields()
    .include({
      _count: {
        select: { subscriptions: true }
      }
    })
    .execute();

  await redisService.set(CACHE_KEY, result, 86400);

  return result;
};

const getPlanById = async (id: string) => {
  const CACHE_KEY = `subscription-plans:admin:id:${id}`;
  const cachedData = await redisService.get<any>(CACHE_KEY);
  if (cachedData) {
    return cachedData;
  }

  const result = await prisma.plan.findUnique({
    where: { id },
  });

  if (!result) {
    throw new AppError(httpStatus.NOT_FOUND, "Plan not found");
  }

  await redisService.set(CACHE_KEY, result, 86400);

  return result;
};

const updatePlan = async (id: string, payload: Partial<ICreatePlanPayload>) => {
  // Ensure the plan exists
  await getPlanById(id);

  const result = await prisma.plan.update({
    where: { id },
    data: payload,
  });

  await redisService.deleteByPattern("subscription-plans*");

  return result;
};

const updatePlanStatus = async (id: string, status: PlanStatus) => {
  // Ensure the plan exists
  await getPlanById(id);

  const result = await prisma.plan.update({
    where: { id },
    data: { status },
  });

  await redisService.deleteByPattern("subscription-plans*");

  return result;
};

export const PlanService = {
  createPlan,
  getAllPlans,
  getPlanById,
  updatePlan,
  updatePlanStatus,
};
