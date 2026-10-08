import { z } from "zod";

export const rejectApplicationValidationSchema = z.object({
  body: z.object({
    reason: z.string()
      .trim()
      .min(1, "Reason is required"),
  }),
});
