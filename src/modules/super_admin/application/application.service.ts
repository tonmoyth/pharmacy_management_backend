import { ApplicationStatus, Prisma } from "@prisma/client";

import httpStatus from "http-status";
import { QueryBuilder } from "../../../utils/queryBuilder";
import { prisma } from "../../../lib/prisma";
import AppError from "../../../errors/AppError";


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

export const AdminApplicationService = {
  getApplications,
  getApplicationDetails,
};
