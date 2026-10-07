import { auth } from "./lib/auth";
import { prisma } from "./lib/prisma";
import { Role, UserStatus } from "../generated";

export const seedAdmin = async () => {
  try {
    const adminEmail = "tonmoynht1930@gmail.com";
    const adminPassword = "12345678";
    const adminName = "SUPER ADMIN VAI";
    const adminPhone = "01407641417";

    // Check if super admin or user with the same email already exists
    const existingSuperAdmin = await prisma.user.findFirst({
      where: {
        OR: [
          { email: adminEmail },
          { role: Role.SUPER_ADMIN },
        ],
      },
    });

    if (existingSuperAdmin) {
      console.log(
        `[Seed] Super admin already exists (Email: ${existingSuperAdmin.email}, Role: ${existingSuperAdmin.role}). Skipping seed.`
      );
      return;
    }

    // Create super admin using Better Auth
    const { user: newAdmin } = await auth.api.signUpEmail({
      body: {
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        phone: adminPhone,
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
        pharmacyId: null,
      }
    });

    console.log("[Seed] Super admin created successfully:", {
      id: newAdmin.id,
      name: newAdmin.name,
      email: newAdmin.email,
      role: newAdmin.role,
      status: newAdmin.status,
    });
  } catch (error) {
    console.error("[Seed] Error creating super admin:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

// Run seed function
seedAdmin();
