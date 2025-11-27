// ============================================================================
// CLOUD FUNCTION: Send Notification on Iqamah Time Changed
// Location: functions/src/notifications/onIqamahChanged.ts
// ============================================================================

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { getActiveTokens, cleanupInvalidTokens } from "../utils/tokenCleanup";
import { buildDataOnlyMessage } from "../utils/messagingHelpers";

export const onIqamahChanged = onDocumentUpdated(
  {
    document: "prayerTimes/current",
    region: "australia-southeast1",
  },
  async (event) => {
    try {
      const before = event.data?.before.data();
      const after = event.data?.after.data();
      
      if (!before || !after) {
        logger.error("No prayer times data found");
        return;
      }

      logger.info("🕌 Prayer times updated, checking for Iqamah changes...");

      // Check which Iqamah times changed
      const prayers = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
      const changes: string[] = [];

      for (const prayer of prayers) {
        const iqamaField = `${prayer}_iqama`;
        const beforeIqama = before[iqamaField];
        const afterIqama = after[iqamaField];

        if (beforeIqama !== afterIqama) {
          const prayerName = prayer.charAt(0).toUpperCase() + prayer.slice(1);
          changes.push(
            `${prayerName}: ${beforeIqama} → ${afterIqama}`
          );
        }
      }

      // If no iqamah changes, don't send notification
      if (changes.length === 0) {
        logger.info("No Iqamah changes detected (Adhan times may have changed)");
        return;
      }

      logger.info("📿 Iqamah times changed:", { changes });

      // Get all active devices with notifications enabled
      const { tokens, deviceIds } = await getActiveTokens(90);

      if (tokens.length === 0) {
        logger.info("No active devices with notifications enabled");
        return;
      }

      // Format notification message
      const changesStr = changes.join(", ");

      // Send data-only message for consistent Notifee styling across all app states
      const messageData: Record<string, string> = {
        type: "prayer",
        title: "📿 Prayer Time Update",
        body: changesStr,
        changes: JSON.stringify(changes),
      };

      const message = buildDataOnlyMessage(messageData, tokens);

      const response = await admin.messaging().sendEachForMulticast(message);

      // Clean up invalid tokens
      await cleanupInvalidTokens(tokens, response.responses, deviceIds);

      logger.info("✅ Iqamah change notifications sent", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
        changes: changes,
      });

    } catch (error: any) {
      logger.error("❌ Error sending iqamah change notifications:", error);
    }
  }
);
