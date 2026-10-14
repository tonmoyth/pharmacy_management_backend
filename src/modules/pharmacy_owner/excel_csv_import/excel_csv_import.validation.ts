import { z } from "zod";

const getTemplateQuerySchema = z.object({
  query: z
    .object({
      type: z.enum(["medicines", "opening-stock"], {
        message: "Query parameter 'type' must be 'medicines' or 'opening-stock'",
      }),
    })
    .strict(),
});

const validateImportSchema = z.object({
  body: z.object({
    type: z.enum(["medicines", "opening-stock"], {
      message: "Field 'type' must be 'medicines' or 'opening-stock'",
    }),
    duplicateMode: z
      .enum(["skip", "update"], {
        message: "Field 'duplicateMode' must be 'skip' or 'update'",
      })
      .default("skip"),
  }),
});

const commitImportSchema = z.object({
  params: z
    .object({
      id: z.string().trim().min(1, "Import job ID is required"),
    })
    .strict(),
});

const getImportByIdSchema = z.object({
  params: z
    .object({
      id: z.string().trim().min(1, "Import job ID is required"),
    })
    .strict(),
});

const getImportsQuerySchema = z.object({
  query: z
    .object({
      page: z.string().optional(),
      limit: z.string().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      type: z
        .enum(["medicines", "opening-stock", "MEDICINES", "OPENING_STOCK"])
        .optional(),
      status: z.enum(["VALIDATED", "FAILED", "COMMITTED"]).optional(),
      duplicateMode: z.enum(["SKIP", "UPDATE", "skip", "update"]).optional(),
      searchTerm: z.string().optional(),
    })
    .passthrough(),
});

export const ExcelCsvImportValidation = {
  getTemplateQuerySchema,
  validateImportSchema,
  commitImportSchema,
  getImportByIdSchema,
  getImportsQuerySchema,
};
