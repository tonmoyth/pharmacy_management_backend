import nodemailer from "nodemailer";
import { envVeriables } from "../config/envConfig";

export const emailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: envVeriables.EMAIL_USER,
    pass: envVeriables.EMAIL_PASS,
  },
});

export const sendEmail = async (to: string, subject: string, text: string) => {
  await emailTransporter.sendMail({
    from: `"Pharmacy_Management_System" <${envVeriables.EMAIL_FROM}>`,
    to,
    subject,
    text,
  });
};
