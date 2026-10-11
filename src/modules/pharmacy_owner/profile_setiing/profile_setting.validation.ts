import { z } from "zod";

const updatePharmacyProfileSchema = z.object({
  body: z
    .object({
      phone: z.string().trim().min(1, "Phone cannot be empty").optional(),
      address: z.string().trim().min(1, "Address cannot be empty").optional(),
      city: z.string().trim().min(1, "City cannot be empty").optional(),
      area: z.string().trim().min(1, "Area cannot be empty").optional(),
      invoiceHeader: z.string().nullable().optional(),
      invoiceFooter: z.string().nullable().optional(),
    })
    .strict(),
});

const updatePharmacySettingsSchema = z.object({
  body: z
    .object({
      maxDiscountPercent: z
        .number({ message: "maxDiscountPercent must be a valid number" })
        .min(0, "maxDiscountPercent must be between 0 and 100")
        .max(100, "maxDiscountPercent must be between 0 and 100"),
    })
    .strict(),
});

export const ProfileSettingValidation = {
  updatePharmacyProfileSchema,
  updatePharmacySettingsSchema,
};
