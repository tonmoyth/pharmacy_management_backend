import { z } from "zod";

const createPaymentSettingsZodSchema = z.object({
  body: z.object({
    bkash_number: z.string({ message: "bkash_number is required" }),
    bkash_account_type: z.string({ message: "bkash_account_type is required" }),
    payment_instructions: z.string({ message: "payment_instructions is required" }),
    screenshot_max_mb: z.string().optional(),
  }),
});

const updatePaymentSettingsZodSchema = z.object({
  body: z.object({
    bkash_number: z.string().optional(),
    bkash_account_type: z.string().optional(),
    payment_instructions: z.string().optional(),
    screenshot_max_mb: z.string().optional(),
  }),
});

export const PaymentSettingValidation = {
  createPaymentSettingsZodSchema,
  updatePaymentSettingsZodSchema,
};
