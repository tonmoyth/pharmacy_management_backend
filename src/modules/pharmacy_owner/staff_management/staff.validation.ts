import { z } from "zod";
import { Role, UserStatus } from "@prisma/client";

const createStaffZodSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, "Name is required"),
      email: z.string().trim().email("Invalid email address"),
      password: z.string().min(6, "Password must be at least 6 characters"),
      role: z.enum([Role.CASHIER, Role.STAFF]),
      phone: z.string().trim().optional(),
    })
    .strict(),
});

const updateStaffZodSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, "Name cannot be empty").optional(),
      email: z.string().trim().email("Invalid email address").optional(),
      phone: z.string().trim().nullable().optional(),
      role: z.enum([Role.CASHIER, Role.STAFF]).optional(),
    })
    .strict(),
});

const updateStaffStatusZodSchema = z.object({
  body: z
    .object({
      status: z.enum([UserStatus.ACTIVE, UserStatus.INACTIVE]),
    })
    .strict(),
});

const resetStaffPasswordZodSchema = z.object({
  body: z
    .object({
      newPassword: z.string().min(6, "New password must be at least 6 characters"),
    })
    .strict(),
});

export const StaffValidation = {
  createStaffZodSchema,
  updateStaffZodSchema,
  updateStaffStatusZodSchema,
  resetStaffPasswordZodSchema,
};
