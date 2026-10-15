import { prisma } from "../lib/prisma";
import { redisService } from "../utils/cache";

/**
 * Job 5: Cleanup
 * Schedule: Daily 03:00 Asia/Dhaka
 *
 * Rules:
 * - Delete expired RefreshTokens and PasswordResetTokens.
 * - Delete expired Sessions.
 * - Clear expired login locks.
 */
export const runCleanupJob = async (): Promise<{
  deletedRefreshTokens: number;
  deletedResetTokens: number;
  deletedSessions: number;
}> => {
  const now = new Date();

  // 1. Delete expired RefreshTokens
  const refreshTokensResult = await prisma.refreshToken.deleteMany({
    where: {
      expiresAt: {
        lt: now,
      },
    },
  });

  // 2. Delete expired PasswordResetTokens
  const resetTokensResult = await prisma.passwordResetToken.deleteMany({
    where: {
      expiresAt: {
        lt: now,
      },
    },
  });

  // 3. Delete expired Sessions
  const sessionsResult = await prisma.session.deleteMany({
    where: {
      expiresAt: {
        lt: now,
      },
    },
  });

  // 4. Clear expired login locks / rate-limit keys in Redis
  try {
    await redisService.deleteByPattern("login_lock:*");
    await redisService.deleteByPattern("auth:lock:*");
  } catch (err) {
    console.warn("Failed to clear redis login lock patterns:", err);
  }

  return {
    deletedRefreshTokens: refreshTokensResult.count,
    deletedResetTokens: resetTokensResult.count,
    deletedSessions: sessionsResult.count,
  };
};
