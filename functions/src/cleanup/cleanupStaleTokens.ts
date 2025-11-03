// ============================================================================
// CLOUD FUNCTION: Cleanup Stale FCM Tokens
// Location: functions/src/cleanup/cleanupStaleTokens.ts
// ============================================================================

import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

export const cleanupStaleTokens = onSchedule(
  {
    schedule: "0 0 * * 0", // Weekly on Sunday at midnight
    timeZone: "Australia/Sydney",
    region: "australia-southeast1",
  },
  async () => {
    try {
      // Define stale threshold (90 days of inactivity)
      const staleThreshold = new Date();
      staleThreshold.setDate(staleThreshold.getDate() - 90);

      logger.info("🧹 Starting stale token cleanup", {
        threshold: staleThreshold.toISOString(),
        daysInactive: 90,
      });

      // Query tokens not seen in 90+ days
      const staleTokensSnapshot = await admin.firestore()
        .collection("fcmTokens")
        .where("lastSeen", "<", admin.firestore.Timestamp.fromDate(staleThreshold))
        .get();

      if (staleTokensSnapshot.empty) {
        logger.info("✅ No stale tokens found - database is clean");
        return;
      }

      logger.info(`📊 Found ${staleTokensSnapshot.size} stale tokens to remove`);

      // Delete in batches (Firestore batch limit is 500)
      const batchSize = 500;
      let totalDeleted = 0;

      for (let i = 0; i < staleTokensSnapshot.docs.length; i += batchSize) {
        const batch = admin.firestore().batch();
        const batchDocs = staleTokensSnapshot.docs.slice(i, i + batchSize);

        batchDocs.forEach((doc) => {
          batch.delete(doc.ref);
        });

        await batch.commit();
        totalDeleted += batchDocs.length;

        logger.info(`🗑️ Deleted batch of ${batchDocs.length} tokens (${totalDeleted}/${staleTokensSnapshot.size})`);
      }

      logger.info("✅ Stale token cleanup complete", {
        totalDeleted,
        remainingTokens: "Will be calculated on next run",
      });
    } catch (error: any) {
      logger.error("❌ Error cleaning up stale tokens:", {
        error: error.message,
        stack: error.stack,
      });
    }
  }
);
