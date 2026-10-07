import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

interface IEnvReturnType {
  PORT: string;
  DATABASE_URL: string;
  FRONTEND_URL: string;

  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;

  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;

  JWT_SECRET_KEY: string;
  JWT_EXPIRES_IN: string;
  JWT_REFRESH_SECRET_KEY: string;
  JWT_REFRESH_EXPIRES_IN: string;

  EMAIL_USER: string;
  EMAIL_PASS: string;
  EMAIL_FROM: string;

  //   // AWS_ACCESS_KEY_ID: string;
  //   // AWS_SECRET_ACCESS_KEY: string;
  //   // AWS_REGION: string;
  //   // AWS_S3_BUCKET: string;

  REDIS_HOST: string;
  REDIS_PORT: string;
  REDIS_PASSWORD: string;
}

const envConfig = (): IEnvReturnType => {
  const envName = [
    "PORT",
    "DATABASE_URL",
    "FRONTEND_URL",

    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",

    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",

    "JWT_SECRET_KEY",
    "JWT_EXPIRES_IN",
    "JWT_REFRESH_SECRET_KEY",
    "JWT_REFRESH_EXPIRES_IN",

    "EMAIL_USER",
    "EMAIL_PASS",
    "EMAIL_FROM",


    // "AWS_ACCESS_KEY_ID",
    // "AWS_SECRET_ACCESS_KEY",
    // "AWS_REGION",
    // "AWS_S3_BUCKET",

    "REDIS_HOST",
    "REDIS_PORT",
    "REDIS_PASSWORD",
  ];
  envName.forEach((element) => {
    if (!process.env[element]) {
      throw new Error(`Missing environment variable: ${element}`);
    }
  });

  return {
    PORT: process.env.PORT!,
    DATABASE_URL: process.env.DATABASE_URL!,
    FRONTEND_URL: process.env.FRONTEND_URL!,

    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME!,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY!,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET!,

    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,

    JWT_SECRET_KEY: process.env.JWT_SECRET_KEY!,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN!,
    JWT_REFRESH_SECRET_KEY: process.env.JWT_REFRESH_SECRET_KEY!,
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN!,

    EMAIL_USER: process.env.EMAIL_USER!,
    EMAIL_PASS: process.env.EMAIL_PASS!,
    EMAIL_FROM: process.env.EMAIL_FROM!,

    REDIS_HOST: process.env.REDIS_HOST!,
    REDIS_PORT: process.env.REDIS_PORT!,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD!,
  };
};

export const envVeriables = envConfig();
