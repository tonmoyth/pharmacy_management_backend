import { z } from "zod";

export const renewSubscriptionSchema = z.object({
  body: z.object({
    planId: z.string(),
    transactionId: z.string(),
    senderNumber: z.string(),
    amount: z.union([z.string(), z.number()]),
    paidAt: z.union([z.string(), z.date()]),
  }),
});
