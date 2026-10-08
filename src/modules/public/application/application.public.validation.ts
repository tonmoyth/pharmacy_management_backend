import { z } from "zod";

// We use preprocess for fields coming from form-data
const createApplicationZodSchema = z.object({
  body: z.object({
    pharmacyName: z.string({ message: "pharmacyName is required" }),
    ownerName: z.string({ message: "ownerName is required" }),
    phone: z.string({ message: "phone is required" }),
    email: z.string({ message: "email is required" }).email(),
    address: z.string({ message: "address is required" }),
    city: z.string({ message: "city is required" }),
    area: z.string({ message: "area is required" }),
    planId: z.string({ message: "planId is required" }),
    
    termsAccepted: z.preprocess((val) => val === "true" || val === true, z.boolean().refine((val) => val === true, {
      message: "Terms must be accepted",
    })),
    
    transactionId: z.string({ message: "transactionId is required" }),
    senderNumber: z.string({ message: "senderNumber is required" }),
    
    amount: z.preprocess((val) => Number(val), z.number().positive({ message: "Amount must be a positive number" })),
    
    paidAt: z.preprocess((val) => (typeof val === "string" ? new Date(val) : val), z.date({
      message: "paidAt must be a valid date",
    })),
  }),
});

export const PublicApplicationValidation = {
  createApplicationZodSchema,
};
