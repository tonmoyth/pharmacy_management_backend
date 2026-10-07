import { z } from "zod";

const updateMeZodSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
  }),
});

const changePasswordZodSchema = z.object({
  body: z.object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
  }),
});

const changeEmailZodSchema = z.object({
  body: z.object({
    newEmail: z.string().email("Invalid email format"),
    password: z.string().min(1, "Password is required for confirmation"),
  }),
});

const forgotPasswordZodSchema = z.object({
  body: z.object({
    email: z.string().email("Invalid email format"),
  }),
});

const resetPasswordZodSchema = z.object({
  body: z.object({
    otp: z.string().min(6, "OTP must be at least 6 characters").max(6, "OTP must be at most 6 characters"),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
  }),
});

export const AuthValidation = {
  updateMeZodSchema,
  changePasswordZodSchema,
  changeEmailZodSchema,
  forgotPasswordZodSchema,
  resetPasswordZodSchema,
};
