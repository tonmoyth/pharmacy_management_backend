import { z } from "zod";

const createCategoryZodSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, "Category name is required")
        .max(100, "Category name cannot exceed 100 characters"),
    })
    .strict(),
});

const updateCategoryZodSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, "Category name is required")
        .max(100, "Category name cannot exceed 100 characters"),
    })
    .strict(),
});

export const CategoryValidation = {
  createCategoryZodSchema,
  updateCategoryZodSchema,
};
