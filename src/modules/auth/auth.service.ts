import { auth } from "../../lib/auth";
import AppError from "../../errors/AppError";
import httpStatus from "http-status";
import { jwtUtils } from "../../utils/jwtUtils";
import { envVeriables } from "../../config/envConfig";
import { tokenUtils } from "../../utils/token";
import { prisma } from "../../lib/prisma";
import { Role } from "@prisma/client";
import crypto from "crypto";
import { hashPassword } from "better-auth/crypto";
import { sendEmail } from "../../utils/email";
const loginUser = async (payload: any) => {
  try {
    const result = await auth.api.signInEmail({
      body: {
        email: payload.email,
        password: payload.password,
      },
    });

    if (!result || !result.user) {
      throw new AppError(httpStatus.UNAUTHORIZED, "Invalid credentials");
    }

    return {
      user: result.user,
      token: result.token || "session-token", // Better Auth session token
    };
  } catch (error: any) {
    const message = error.body?.message || error.message || "Invalid credentials";
    const statusCode = error.statusCode || httpStatus.UNAUTHORIZED;
    throw new AppError(statusCode, message);
  }
};

const getNewRefreshToken = async (refreshToken: string, sessionToken: string) => {
  if (!refreshToken || !sessionToken) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh or session token.");
  }

  const verifyResult = await jwtUtils.verifyToken(
    refreshToken,
    envVeriables.JWT_REFRESH_SECRET_KEY,
  );

  if (!verifyResult || !verifyResult.seccess) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh token. Please login again.");
  }

  const session = await prisma.session.findUnique({
    where: {
      token: sessionToken,
    },
  });

  if (!session) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid session token.");
  }

  const data = verifyResult.data as any;

  const jwtPayload = {
    id: data.id,
    email: data.email,
    role: data.role,
  };

  const accessToken = tokenUtils.getToken(jwtPayload);
  const newRefreshToken = tokenUtils.getRefreshToken(jwtPayload);

  const updateSessionTime = await prisma.session.update({
    where: {
      token: sessionToken,
    },
    data: {
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // extends by 24h
    },
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    session: updateSessionTime,
  };
};

const logoutUser = async (sessionToken: string) => {
  if (!sessionToken) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Session token is required.");
  }

  const session = await prisma.session.findUnique({
    where: {
      token: sessionToken,
    },
  });

  if (!session) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid session token.");
  }

  await prisma.session.delete({
    where: {
      token: sessionToken,
    },
  });

  return null;
};

const getMe = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      pharmacy: {
        include: {
          subscriptions: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
      },
    },
  });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  // Hide passwordHash or any sensitive fields if necessary
  // (Better Auth stores passwords in Account model, so User model is mostly safe)

  return user;
};

const updateMe = async (userId: string, payload: { name?: string; phone?: string }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: payload,
  });

  return updatedUser;
};

const changePassword = async (
  payload: {
    currentPassword?: string;
    newPassword: string;
  },
  session: string,
) => {
  const sessionRecord = await prisma.session.findUnique({
    where: {
      token: session,
    },
    include: {
      user: true,
    },
  });

  if (!sessionRecord || !sessionRecord.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid session token.");
  }

  const { currentPassword, newPassword } = payload;
  const user = sessionRecord.user;

  if (!user.mustChangePassword) {
    if (!currentPassword) {
      throw new AppError(httpStatus.BAD_REQUEST, "Current password is required");
    }

    try {
      await auth.api.changePassword({
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
        headers: {
          Authorization: `Bearer ${session}`,
        },
      } as any);
    } catch (error: any) {
      const message = error.body?.message || error.message || "Incorrect current password";
      throw new AppError(httpStatus.UNAUTHORIZED, message);
    }
  } else {
    try {
      await auth.api.changePassword({
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
        headers: {
          Authorization: `Bearer ${session}`,
        },
      } as any);
    } catch (error: any) {
      const message = error.body?.message || error.message || "Failed to set password";
      throw new AppError(httpStatus.BAD_REQUEST, message);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    await tx.session.deleteMany({
      where: {
        userId: user.id,
        token: {
          not: session
        }
      },
    });

    await tx.refreshToken.deleteMany({
      where: { userId: user.id },
    });
  });

  // const accessToken = tokenUtils.getToken({
  //   id: user.id,
  //   email: user.email,
  //   role: user.role,
  // } as any);

  const refreshToken = tokenUtils.getRefreshToken({
    id: user.id,
    email: user.email,
    role: user.role,
  } as any);

  return {
    // accessToken,
    refreshToken,
  };
};

const changeEmail = async (
  payload: { newEmail: string; password: string },
  sessionToken: string,
  reqIp?: string,
  reqUserAgent?: string
) => {
  const sessionRecord = await prisma.session.findUnique({
    where: { token: sessionToken },
    include: { user: true },
  });

  if (!sessionRecord || !sessionRecord.user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid session token.");
  }

  const user = sessionRecord.user;
  const { newEmail, password } = payload;

  if (user.email === newEmail) {
    throw new AppError(httpStatus.BAD_REQUEST, "New email cannot be the same as the current email");
  }

  const existingEmail = await prisma.user.findUnique({
    where: { email: newEmail },
  });

  if (existingEmail) {
    throw new AppError(httpStatus.CONFLICT, "Email is already in use by another account");
  }

  try {
    const signInRes = (await auth.api.signInEmail({
      body: {
        email: user.email,
        password: password,
      },
    })) as any;

    if (signInRes?.session) {
      await prisma.session.delete({
        where: { token: signInRes.session.token },
      });
    }
  } catch (error: any) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Incorrect password");
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { email: newEmail },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        userName: user.name,
        userRole: user.role as any,
        pharmacyId: (user as any).pharmacyId,
        action: "EMAIL_CHANGED",
        entityType: "User",
        entityId: user.id,
        oldValue: { email: user.email },
        newValue: { email: newEmail },
        reason: "User requested email change",
        ip: reqIp,
        userAgent: reqUserAgent,
      },
    });

    return updated;
  });

  return updatedUser;
};

const forgotPassword = async (payload: { email: string }) => {
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
  });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.role !== Role.SUPER_ADMIN && user.role !== Role.PHARMACY_OWNER) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only Super Admin and Pharmacy Owner can reset password via this method."
    );
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit OTP
  const tokenHash = crypto.createHash("sha256").update(otp).digest("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 10); // 10 minutes expiration

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const emailText = `Your OTP for password reset is: ${otp}\nThis OTP will expire in 10 minutes. If you did not request this, please ignore this email.`;

  await sendEmail(user.email, "Password Reset OTP", emailText);

  return null;
};

const resetPassword = async (payload: { otp: string; newPassword: string }) => {
  const tokenHash = crypto.createHash("sha256").update(payload.otp).digest("hex");

  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!resetRecord) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid or expired reset token");
  }

  if (resetRecord.usedAt) {
    throw new AppError(httpStatus.BAD_REQUEST, "This reset token has already been used");
  }

  if (resetRecord.expiresAt < new Date()) {
    throw new AppError(httpStatus.BAD_REQUEST, "Reset token has expired");
  }

  const hashedPassword = await hashPassword(payload.newPassword);

  await prisma.$transaction(async (tx) => {
    // Mark token as used
    await tx.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    });

    // Update the password in Better Auth's Account table
    await tx.account.updateMany({
      where: { userId: resetRecord.userId },
      data: { password: hashedPassword },
    });

    // Revoke all refresh tokens/sessions natively via Prisma
    await tx.session.deleteMany({
      where: { userId: resetRecord.userId },
    });
  });

  return null;
};

export const AuthService = {
  loginUser,
  getNewRefreshToken,
  logoutUser,
  getMe,
  updateMe,
  changePassword,
  changeEmail,
  forgotPassword,
  resetPassword,
};

