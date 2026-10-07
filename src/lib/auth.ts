import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP, bearer } from "better-auth/plugins";
import nodemailer from "nodemailer";

import { prisma } from "./prisma";
import { envVeriables } from "../config/envConfig";

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: envVeriables.EMAIL_USER,
        pass: envVeriables.EMAIL_PASS,
    },
});

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    user: {
        additionalFields: {
            role: {
                type: "string",
                required: false,
                defaultValue: "STAFF",
            },
            status: {
                type: "string",
                required: false,
                defaultValue: "ACTIVE",
            },
            phone: {
                type: "string",
                required: false,
            },
            pharmacyId: {
                type: "string",
                required: false,
            },
            createdById: {
                type: "string",
                required: false,
            },
            mustChangePassword: {
                type: "boolean",
                required: false,
                defaultValue: true,
            },
            lastLoginAt: {
                type: "date",
                required: false,
            },
            passwordChangedAt: {
                type: "date",
                required: false,
            },
        },
    },

    emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
    },

    plugins: [
        bearer(),
        emailOTP({
            expiresIn: 60, // OTP expires in 1 minutes
            otpLength: 6, // 6 digits OTP
            allowedAttempts: 3, // Prevent brute-force OTP attempts
            sendVerificationOnSignUp: true, // Automatically send OTP upon user registration
            overrideDefaultEmailVerification: true,
            async sendVerificationOTP({ email, otp, type }) {
                const subject =
                    type === "forget-password"
                        ? "Reset your password"
                        : "Email Verification";
                const text = `Your OTP for ${type} is: ${otp}`;

                await transporter.sendMail({
                    from: `"Pharmacy_Management_System" <${envVeriables.EMAIL_FROM}>`,
                    to: email,
                    subject,
                    text,
                });
            },
        }),
    ],
});