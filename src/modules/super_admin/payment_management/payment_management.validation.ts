import { z } from "zod";

export const rejectPaymentSchema = z.object({
  body: z.object({
    reason: z.string({
      message: "Rejection reason is required",
    }).min(3, "Reason must be at least 3 characters long"),
  }),
});

export const refundPaymentSchema = z.object({
  body: z.object({
    note: z.string({
      message: "Refund note is required",
    }).min(3, "Note must be at least 3 characters long"),
  }),
});
