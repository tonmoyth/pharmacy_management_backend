import httpStatus from "http-status";
import { Role, UserStatus } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import AppError from "../../../errors/AppError";
import { prisma } from "../../../lib/prisma";
import { sendEmail } from "../../../utils/email";
import { QueryBuilder } from "../../../utils/queryBuilder";

export interface ICreateStaffPayload {
  name: string;
  email: string;
  password: string;
  role: Role;
  phone?: string;
}

export interface IUpdateStaffPayload {
  name?: string;
  email?: string;
  phone?: string | null;
  role?: Role;
}

const getStaff = async (pharmacyId: string, query: Record<string, unknown>) => {
  const normalizedQuery = {
    ...query,
    searchTerm: (query.searchTerm || query.search) as string | undefined,
  };

  const staffQuery = new QueryBuilder(prisma.user, normalizedQuery as any, {
    searchableFields: ["name", "email"],
    filterableFields: ["role", "status"],
  })
    .search()
    .filter()
    .sort()
    .paginate();

  // Enforce pharmacy isolation and restrict to STAFF and CASHIER roles only
  const requestedRole = query.role as Role | undefined;
  const isAllowedRole = requestedRole === Role.CASHIER || requestedRole === Role.STAFF;

  const whereCondition: any = {
    pharmacyId,
    role: isAllowedRole ? requestedRole : { in: [Role.CASHIER, Role.STAFF] },
  };

  if (query.status) {
    whereCondition.status = query.status;
  }

  staffQuery.where(whereCondition);

  const result = await staffQuery.execute();

  const cleanData = result.data.map((user: any) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    image: user.image,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    passwordChangedAt: user.passwordChangedAt,
    createdById: user.createdById,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }));

  return {
    meta: result.meta,
    data: cleanData,
  };
};

const createStaff = async (
  pharmacyId: string,
  owner: { id: string; name: string; role: Role },
  payload: ICreateStaffPayload,
  ip?: string,
  userAgent?: string
) => {
  // 1. Role validation: Only CASHIER or STAFF allowed
  if (payload.role !== Role.CASHIER && payload.role !== Role.STAFF) {
    throw new AppError(httpStatus.BAD_REQUEST, "Role must be either CASHIER or STAFF");
  }

  const normalizedEmail = payload.email.toLowerCase().trim();

  // 2. Email uniqueness check
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    throw new AppError(httpStatus.CONFLICT, "A user with this email already exists");
  }

  // 3. Hash password securely using Better Auth's crypto utility
  const hashedPassword = await hashPassword(payload.password);

  // 4. Create User and Better Auth Account in a transaction
  const newStaff = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: payload.name.trim(),
        email: normalizedEmail,
        role: payload.role,
        phone: payload.phone?.trim() || null,
        pharmacyId,
        createdById: owner.id,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
        emailVerified: true,
        accounts: {
          create: {
            accountId: normalizedEmail,
            providerId: "credential",
            password: hashedPassword,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        pharmacyId: true,
        createdById: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await tx.auditLog.create({
      data: {
        pharmacyId,
        userId: owner.id,
        userName: owner.name,
        userRole: owner.role,
        action: "STAFF_CREATED",
        entityType: "User",
        entityId: user.id,
        newValue: {
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          status: user.status,
        },
        reason: `Created new ${user.role} account for ${user.name}`,
        ip,
        userAgent,
      },
    });

    return user;
  });

  // 5. Send login credentials to the staff member via email
  const emailSubject = "Your Pharmacy Staff Account Credentials";
  const emailBody = `Hello ${newStaff.name},\n\nYou have been added as a ${newStaff.role} in your pharmacy system.\n\nYour login credentials are:\nEmail: ${newStaff.email}\nPassword: ${payload.password}\n\nPlease keep these credentials secure. If you need any assistance, please contact your Pharmacy Owner.\n\nRegards,\nPharmacy Management System`;

  sendEmail(newStaff.email, emailSubject, emailBody).catch((err) => {
    console.error("Failed to send staff welcome email:", err);
  });

  return newStaff;
};

const getStaffById = async (pharmacyId: string, staffId: string) => {
  const staff = await prisma.user.findFirst({
    where: {
      id: staffId,
      pharmacyId,
      role: { in: [Role.CASHIER, Role.STAFF] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      image: true,
      mustChangePassword: true,
      lastLoginAt: true,
      passwordChangedAt: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!staff) {
    throw new AppError(httpStatus.NOT_FOUND, "Staff member not found");
  }

  return staff;
};

const updateStaff = async (
  pharmacyId: string,
  staffId: string,
  owner: { id: string; name: string; role: Role },
  payload: IUpdateStaffPayload,
  ip?: string,
  userAgent?: string
) => {
  const existingStaff = await prisma.user.findFirst({
    where: {
      id: staffId,
      pharmacyId,
      role: { in: [Role.CASHIER, Role.STAFF] },
    },
  });

  if (!existingStaff) {
    throw new AppError(httpStatus.NOT_FOUND, "Staff member not found");
  }

  if (payload.role && payload.role !== Role.CASHIER && payload.role !== Role.STAFF) {
    throw new AppError(httpStatus.BAD_REQUEST, "Role must be either CASHIER or STAFF");
  }

  let normalizedEmail: string | undefined;
  if (payload.email) {
    normalizedEmail = payload.email.toLowerCase().trim();
    if (normalizedEmail !== existingStaff.email) {
      const emailInUse = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (emailInUse) {
        throw new AppError(httpStatus.CONFLICT, "Email is already in use by another account");
      }
    }
  }

  const updateData: Record<string, any> = {};
  if (payload.name !== undefined) updateData.name = payload.name.trim();
  if (normalizedEmail !== undefined) updateData.email = normalizedEmail;
  if (payload.phone !== undefined) updateData.phone = payload.phone?.trim() || null;
  if (payload.role !== undefined) updateData.role = payload.role;

  const changedFields: string[] = [];
  const oldValue: Record<string, any> = {};
  const newValue: Record<string, any> = {};

  for (const [key, val] of Object.entries(updateData)) {
    const prev = (existingStaff as any)[key];
    if (prev !== val) {
      changedFields.push(key);
      oldValue[key] = prev;
      newValue[key] = val;
    }
  }

  const updatedStaff = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: staffId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        image: true,
        mustChangePassword: true,
        lastLoginAt: true,
        passwordChangedAt: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (normalizedEmail && normalizedEmail !== existingStaff.email) {
      await tx.account.updateMany({
        where: {
          userId: staffId,
          providerId: "credential",
        },
        data: {
          accountId: normalizedEmail,
        },
      });
    }

    if (changedFields.length > 0) {
      await tx.auditLog.create({
        data: {
          pharmacyId,
          userId: owner.id,
          userName: owner.name,
          userRole: owner.role,
          action: "STAFF_UPDATED",
          entityType: "User",
          entityId: staffId,
          oldValue,
          newValue,
          reason: `Updated staff fields: ${changedFields.join(", ")}`,
          ip,
          userAgent,
        },
      });
    }

    return updated;
  });

  return updatedStaff;
};

const updateStaffStatus = async (
  pharmacyId: string,
  staffId: string,
  owner: { id: string; name: string; role: Role },
  status: UserStatus,
  ip?: string,
  userAgent?: string
) => {
  const existingStaff = await prisma.user.findFirst({
    where: {
      id: staffId,
      pharmacyId,
      role: { in: [Role.CASHIER, Role.STAFF] },
    },
  });

  if (!existingStaff) {
    throw new AppError(httpStatus.NOT_FOUND, "Staff member not found");
  }

  const updatedStaff = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: staffId },
      data: { status },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        image: true,
        mustChangePassword: true,
        lastLoginAt: true,
        passwordChangedAt: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // When deactivated to INACTIVE, immediately revoke all active sessions and refresh tokens
    if (status === UserStatus.INACTIVE) {
      await tx.session.deleteMany({
        where: { userId: staffId },
      });
      await tx.refreshToken.deleteMany({
        where: { userId: staffId },
      });
    }

    await tx.auditLog.create({
      data: {
        pharmacyId,
        userId: owner.id,
        userName: owner.name,
        userRole: owner.role,
        action: "STAFF_STATUS_UPDATED",
        entityType: "User",
        entityId: staffId,
        oldValue: { status: existingStaff.status },
        newValue: { status },
        reason: `Staff status changed from ${existingStaff.status} to ${status}`,
        ip,
        userAgent,
      },
    });

    return updated;
  });

  return updatedStaff;
};

const resetStaffPassword = async (
  pharmacyId: string,
  staffId: string,
  owner: { id: string; name: string; role: Role },
  newPassword: string,
  ip?: string,
  userAgent?: string
) => {
  const existingStaff = await prisma.user.findFirst({
    where: {
      id: staffId,
      pharmacyId,
      role: { in: [Role.CASHIER, Role.STAFF] },
    },
  });

  if (!existingStaff) {
    throw new AppError(httpStatus.NOT_FOUND, "Staff member not found");
  }

  // 1. Hash password securely
  const hashedPassword = await hashPassword(newPassword);

  // 2. Update password in Better Auth Account table and revoke sessions in transaction
  await prisma.$transaction(async (tx) => {
    await tx.account.updateMany({
      where: {
        userId: staffId,
        providerId: "credential",
      },
      data: {
        password: hashedPassword,
      },
    });

    await tx.user.update({
      where: { id: staffId },
      data: {
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    // Revoke all existing sessions and refresh tokens
    await tx.session.deleteMany({
      where: { userId: staffId },
    });
    await tx.refreshToken.deleteMany({
      where: { userId: staffId },
    });

    // Write audit log without plain text password or hash
    await tx.auditLog.create({
      data: {
        pharmacyId,
        userId: owner.id,
        userName: owner.name,
        userRole: owner.role,
        action: "STAFF_PASSWORD_RESET",
        entityType: "User",
        entityId: staffId,
        reason: `Password reset by Pharmacy Owner for staff ${existingStaff.name} (${existingStaff.email})`,
        ip,
        userAgent,
      },
    });
  });

  // 3. Send email notification with new credentials
  const emailSubject = "Your Password Has Been Reset";
  const emailBody = `Hello ${existingStaff.name},\n\nYour password for the Pharmacy Management System has been reset by your Pharmacy Owner.\n\nYour new login credentials are:\nEmail: ${existingStaff.email}\nPassword: ${newPassword}\n\nPlease use this new password to log in. Contact your Pharmacy Owner if you have questions.\n\nRegards,\nPharmacy Management System`;

  sendEmail(existingStaff.email, emailSubject, emailBody).catch((err) => {
    console.error("Failed to send staff password reset email:", err);
  });

  return null;
};

export const StaffService = {
  getStaff,
  createStaff,
  getStaffById,
  updateStaff,
  updateStaffStatus,
  resetStaffPassword,
};
