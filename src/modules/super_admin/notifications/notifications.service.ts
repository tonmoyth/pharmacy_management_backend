import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/queryBuilder";
import AppError from "../../../errors/AppError";
import httpStatus from "http-status";

const getNotifications = async (query: Record<string, unknown>) => {
  // Super Admin notifications have pharmacyId: null
  query.pharmacyId = null; 

  const notificationsQuery = new QueryBuilder(prisma.notification, query as any, {
    searchableFields: ["title", "message"],
    filterableFields: ["type", "isRead", "pharmacyId"],
  })
    .search()
    .filter()
    .sort()
    .paginate();

  return await notificationsQuery.execute();
};

const markAsRead = async (id: string) => {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification || notification.pharmacyId !== null) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found or not accessible");
  }

  return await prisma.notification.update({
    where: { id },
    data: { isRead: true, readAt: new Date() }
  });
};

const markAllAsRead = async () => {
  return await prisma.notification.updateMany({
    where: { pharmacyId: null, isRead: false },
    data: { isRead: true, readAt: new Date() }
  });
};

export const AdminNotificationsService = {
  getNotifications,
  markAsRead,
  markAllAsRead,
};
