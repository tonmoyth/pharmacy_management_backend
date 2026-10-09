import { z } from "zod";

export const suspendPharmacySchema = z.object({
  body: z.object({
    reason: z.string().trim().min(1, "Reason is required"),
  }),
});

export const deactivatePharmacySchema = suspendPharmacySchema;
