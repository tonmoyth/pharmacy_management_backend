import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/queryBuilder";

const getAuditLogs = async (query: Record<string, unknown>) => {
  const auditLogsQuery = new QueryBuilder(prisma.auditLog, query as any, {
    searchableFields: ["userName", "action", "entityType", "reason"],
    filterableFields: ["userId", "action", "entityType", "pharmacyId"],
  })
    .search()
    .filter()
    .sort()
    .paginate()
    .include({ user: { select: { name: true, email: true } }, pharmacy: { select: { name: true } } });

  // Handle custom date range filtering if from/to provided in query
  if (query.from || query.to) {
    const createdAtFilter: any = {};
    if (query.from) createdAtFilter.gte = new Date(query.from as string);
    if (query.to) createdAtFilter.lte = new Date(query.to as string);
    
    auditLogsQuery.where({
      createdAt: createdAtFilter
    });
  }

  return await auditLogsQuery.execute();
};

export const AdminAuditLogsService = {
  getAuditLogs,
};
