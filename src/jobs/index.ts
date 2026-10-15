import cron from "node-cron";
import { runSubscriptionStatusJob } from "./subscriptionStatus.job";
import { runExpiryEmailsJob } from "./expiryEmails.job";
import { runStockAlertsJob } from "./stockAlerts.job";
import { runArchiveDeleteJob } from "./archiveDelete.job";
import { runCleanupJob } from "./cleanup.job";

const TIMEZONE = "Asia/Dhaka";

/**
 * Initialize and schedule all 5 background cron jobs according to Phase 1 requirements.
 */
export const initScheduledJobs = () => {
  console.log("⏰ Initializing scheduled cron jobs (Timezone: Asia/Dhaka)...");

  // Job 1: Subscription Status - Daily at 00:05 Asia/Dhaka
  cron.schedule(
    "5 0 * * *",
    async () => {
      console.log("▶ [CRON] Running Job 1: Subscription Status Check...");
      try {
        const result = await runSubscriptionStatusJob();
        console.log(
          `✔ [CRON] Job 1 finished: ${result.expiringSoonCount} expiring soon, ${result.expiredCount} expired.`
        );
      } catch (err) {
        console.error("✖ [CRON] Job 1 failed:", err);
      }
    },
    { timezone: TIMEZONE }
  );

  // Job 2: Expiry Emails - Daily at 08:00 Asia/Dhaka
  cron.schedule(
    "0 8 * * *",
    async () => {
      console.log("▶ [CRON] Running Job 2: Subscription Expiry Emails...");
      try {
        const result = await runExpiryEmailsJob();
        console.log(
          `✔ [CRON] Job 2 finished: ${result.expiringEmailsSent} warning emails, ${result.expiredEmailsSent} expired emails sent.`
        );
      } catch (err) {
        console.error("✖ [CRON] Job 2 failed:", err);
      }
    },
    { timezone: TIMEZONE }
  );

  // Job 3: Stock & Due Alerts - Daily at 06:00 Asia/Dhaka
  cron.schedule(
    "0 6 * * *",
    async () => {
      console.log("▶ [CRON] Running Job 3: Stock & Due Alerts...");
      try {
        const result = await runStockAlertsJob();
        console.log(
          `✔ [CRON] Job 3 finished: ${result.lowStockCount} low stock, ${result.expiringSoonCount} expiring soon, ${result.expiredCount} expired, ${result.customerDueCount} customer dues, ${result.supplierDueCount} supplier dues.`
        );
      } catch (err) {
        console.error("✖ [CRON] Job 3 failed:", err);
      }
    },
    { timezone: TIMEZONE }
  );

  // Job 4: Archive / Delete - Daily at 02:00 Asia/Dhaka
  cron.schedule(
    "0 2 * * *",
    async () => {
      console.log("▶ [CRON] Running Job 4: Archive / Delete Inactive Pharmacies...");
      try {
        const result = await runArchiveDeleteJob();
        console.log(
          `✔ [CRON] Job 4 finished: ${result.archivedPharmaciesCount} pharmacies archived.`
        );
      } catch (err) {
        console.error("✖ [CRON] Job 4 failed:", err);
      }
    },
    { timezone: TIMEZONE }
  );

  // Job 5: Cleanup - Daily at 03:00 Asia/Dhaka
  cron.schedule(
    "0 3 * * *",
    async () => {
      console.log("▶ [CRON] Running Job 5: System Cleanup...");
      try {
        const result = await runCleanupJob();
        console.log(
          `✔ [CRON] Job 5 finished: ${result.deletedRefreshTokens} refresh tokens, ${result.deletedResetTokens} reset tokens, ${result.deletedSessions} sessions cleaned up.`
        );
      } catch (err) {
        console.error("✖ [CRON] Job 5 failed:", err);
      }
    },
    { timezone: TIMEZONE }
  );

  console.log("✅ All 5 scheduled cron jobs registered successfully.");
};

export {
  runSubscriptionStatusJob,
  runExpiryEmailsJob,
  runStockAlertsJob,
  runArchiveDeleteJob,
  runCleanupJob,
};
