import httpStatus from "http-status";
import { Role } from "@prisma/client";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { QueryBuilder } from "../../../utils/queryBuilder";
import { categorySearchableFields } from "./category.constant";

export interface ICategoryUserContext {
  id: string;
  name: string;
  role: Role;
}

export interface ICategoryPayload {
  name: string;
}

/**
 * Normalizes category name by trimming whitespace and collapsing multiple spaces.
 */
export const normalizeCategoryName = (name: string): string => {
  return name.trim().replace(/\s+/g, " ");
};

/**
 * Retrieve categories belonging to the authenticated user's pharmacy.
 * Supports pagination, sorting, and name searching via QueryBuilder.
 */
const getCategories = async (
  pharmacyId: string,
  query: Record<string, unknown>
) => {
  const normalizedQuery = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
  };

  const categoryQuery = new QueryBuilder(
    prisma.category,
    normalizedQuery as any,
    {
      searchableFields: categorySearchableFields,
    }
  )
    .search()
    .filter()
    .sort()
    .paginate()
    .include({
      _count: {
        select: {
          medicines: true,
        },
      },
    });

  // Strict tenant isolation: always filter by authenticated pharmacyId
  categoryQuery.where({ pharmacyId });

  const result = await categoryQuery.execute();

  return {
    meta: result.meta,
    data: result.data,
  };
};

/**
 * Retrieve distinct category suggestions across all pharmacies.
 * Deduplicates names case-insensitively and exposes ONLY suggestion names,
 * preventing any leakage of pharmacy IDs, category IDs, or other tenant data.
 */
const getCategorySuggestions = async (query: Record<string, unknown>) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Number(query.limit) || 20);
  const skip = (page - 1) * limit;

  const rawSearch = (query.searchTerm || query.search) as string | undefined;
  const searchTerm = rawSearch ? rawSearch.trim() : undefined;

  let suggestions: Array<{ name: string }>;
  let total: number;

  if (searchTerm && searchTerm.length > 0) {
    const searchPattern = `%${searchTerm}%`;

    const [dataResult, countResult] = await Promise.all([
      prisma.$queryRaw<Array<{ name: string }>>`
        SELECT DISTINCT ON (LOWER(TRIM("name"))) TRIM("name") AS name
        FROM "Category"
        WHERE "name" ILIKE ${searchPattern}
        ORDER BY LOWER(TRIM("name")) ASC, "createdAt" DESC
        LIMIT ${limit} OFFSET ${skip}
      `,
      prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT COUNT(DISTINCT LOWER(TRIM("name")))::int AS count
        FROM "Category"
        WHERE "name" ILIKE ${searchPattern}
      `,
    ]);

    suggestions = dataResult.map((item) => ({ name: item.name }));
    total = Number(countResult[0]?.count || 0);
  } else {
    const [dataResult, countResult] = await Promise.all([
      prisma.$queryRaw<Array<{ name: string }>>`
        SELECT DISTINCT ON (LOWER(TRIM("name"))) TRIM("name") AS name
        FROM "Category"
        ORDER BY LOWER(TRIM("name")) ASC, "createdAt" DESC
        LIMIT ${limit} OFFSET ${skip}
      `,
      prisma.$queryRaw<Array<{ count: bigint | number }>>`
        SELECT COUNT(DISTINCT LOWER(TRIM("name")))::int AS count
        FROM "Category"
      `,
    ]);

    suggestions = dataResult.map((item) => ({ name: item.name }));
    total = Number(countResult[0]?.count || 0);
  }

  const totalPages = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
    data: suggestions,
  };
};

/**
 * Create a new Category for the authenticated pharmacy.
 * Prevents case-insensitive duplicate names within the same pharmacy.
 */
const createCategory = async (
  pharmacyId: string,
  user: ICategoryUserContext,
  payload: ICategoryPayload,
  ip?: string,
  userAgent?: string
) => {
  const normalizedName = normalizeCategoryName(payload.name);

  // Pre-write check: case-insensitive duplicate detection within this pharmacy
  const existingCategory = await prisma.category.findFirst({
    where: {
      pharmacyId,
      name: {
        equals: normalizedName,
        mode: "insensitive",
      },
    },
  });

  if (existingCategory) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Category with name "${normalizedName}" already exists in your pharmacy.`
    );
  }

  return await prisma.$transaction(async (tx) => {
    try {
      const newCategory = await tx.category.create({
        data: {
          pharmacyId,
          name: normalizedName,
        },
      });

      if (user) {
        await tx.auditLog.create({
          data: {
            pharmacyId,
            userId: user.id,
            userName: user.name,
            userRole: user.role,
            action: "CATEGORY_CREATED",
            entityType: "Category",
            entityId: newCategory.id,
            newValue: { name: newCategory.name },
            reason: `Created category: ${newCategory.name}`,
            ip,
            userAgent,
          },
        });
      }

      return newCategory;
    } catch (error: any) {
      if (error.code === "P2002") {
        throw new AppError(
          httpStatus.CONFLICT,
          `Category with name "${normalizedName}" already exists in your pharmacy.`
        );
      }
      throw error;
    }
  });
};

/**
 * Rename an existing Category belonging to the authenticated pharmacy.
 * Verifies tenant ownership and prevents duplicate names within the pharmacy.
 */
const updateCategory = async (
  pharmacyId: string,
  id: string,
  user: ICategoryUserContext,
  payload: ICategoryPayload,
  ip?: string,
  userAgent?: string
) => {
  // Ownership verification: ensures category belongs to the authenticated pharmacy
  const existingCategory = await prisma.category.findFirst({
    where: {
      id,
      pharmacyId,
    },
  });

  if (!existingCategory) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Category not found in your pharmacy"
    );
  }

  const normalizedName = normalizeCategoryName(payload.name);

  // Pre-write duplicate check against other categories in the same pharmacy
  const duplicate = await prisma.category.findFirst({
    where: {
      pharmacyId,
      id: { not: id },
      name: {
        equals: normalizedName,
        mode: "insensitive",
      },
    },
  });

  if (duplicate) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Another category with name "${normalizedName}" already exists in your pharmacy.`
    );
  }

  return await prisma.$transaction(async (tx) => {
    try {
      const updatedCategory = await tx.category.update({
        where: { id },
        data: {
          name: normalizedName,
        },
      });

      if (user) {
        await tx.auditLog.create({
          data: {
            pharmacyId,
            userId: user.id,
            userName: user.name,
            userRole: user.role,
            action: "CATEGORY_UPDATED",
            entityType: "Category",
            entityId: updatedCategory.id,
            oldValue: { name: existingCategory.name },
            newValue: { name: updatedCategory.name },
            reason: `Renamed category from "${existingCategory.name}" to "${updatedCategory.name}"`,
            ip,
            userAgent,
          },
        });
      }

      return updatedCategory;
    } catch (error: any) {
      if (error.code === "P2002") {
        throw new AppError(
          httpStatus.CONFLICT,
          `Category with name "${normalizedName}" already exists in your pharmacy.`
        );
      }
      throw error;
    }
  });
};

/**
 * Delete a category belonging to the authenticated pharmacy.
 * Rejects deletion if medicines are currently assigned to the category.
 */
const deleteCategory = async (
  pharmacyId: string,
  id: string,
  user: ICategoryUserContext,
  ip?: string,
  userAgent?: string
) => {
  // Ownership verification: ensure category belongs to the authenticated pharmacy
  const existingCategory = await prisma.category.findFirst({
    where: {
      id,
      pharmacyId,
    },
  });

  if (!existingCategory) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Category not found in your pharmacy"
    );
  }

  // Check if any medicines are assigned to this category
  const medicinesCount = await prisma.medicine.count({
    where: {
      categoryId: id,
    },
  });

  if (medicinesCount > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Cannot delete category "${existingCategory.name}" because it is currently assigned to ${medicinesCount} medicine(s). Please reassign or remove the medicines first.`
    );
  }

  return await prisma.$transaction(async (tx) => {
    const deletedCategory = await tx.category.delete({
      where: {
        id,
      },
    });

    if (user) {
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          action: "CATEGORY_DELETED",
          entityType: "Category",
          entityId: existingCategory.id,
          oldValue: { name: existingCategory.name },
          reason: `Deleted category: ${existingCategory.name}`,
          ip,
          userAgent,
        },
      });
    }

    return deletedCategory;
  });
};

export const CategoryService = {
  getCategories,
  getCategorySuggestions,
  createCategory,
  updateCategory,
  deleteCategory,
};
