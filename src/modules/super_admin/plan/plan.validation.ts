import { z } from "zod";
import { PlanStatus } from "@prisma/client";

const createPlanZodSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required"),
    durationDays: z.number().int().positive("Duration must be a positive integer"),
    price: z.number().refine((val) => /^\d+(\.\d{1,2})?$/.test(val.toString()), {
      message: "Price must be a valid monetary value with up to 2 decimal places",
    }),
    features: z.array(z.string()).default([]),
    status: z.nativeEnum(PlanStatus).optional(),
    sortOrder: z.number().int().optional(),
  }),
});

const updatePlanZodSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required").optional(),
    durationDays: z.number().int().positive("Duration must be a positive integer").optional(),
    price: z.number().refine((val) => /^\d+(\.\d{1,2})?$/.test(val.toString()), {
      message: "Price must be a valid monetary value with up to 2 decimal places",
    }).optional(),
    features: z.array(z.string()).optional(),
    sortOrder: z.number().int().optional(),
  }),
});

const updatePlanStatusZodSchema = z.object({
  body: z.object({
    status: z.nativeEnum(PlanStatus),
  }),
});

export const PlanValidation = {
  createPlanZodSchema,
  updatePlanZodSchema,
  updatePlanStatusZodSchema,
};
