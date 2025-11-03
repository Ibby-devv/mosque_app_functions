// ============================================================================
// CLOUD FUNCTION: Send Notification on Iqamah Time Changed
// Location: functions/src/notifications/onIqamahChanged.ts
// ============================================================================

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

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

      // Get all devices with notifications enabled
      const tokensSnapshot = await admin.firestore()
        .collection("fcmTokens")
        .where("notificationsEnabled", "==", true)
        .get();

      if (tokensSnapshot.empty) {
        logger.info("No devices with notifications enabled");
        return;
      }

      // Collect FCM tokens
      const tokens: string[] = [];
      tokensSnapshot.forEach((doc) => {
        const tokenData = doc.data();
        if (tokenData.fcmToken) {
          tokens.push(tokenData.fcmToken);
        }
      });

      if (tokens.length === 0) {
        logger.info("No FCM tokens found");
        return;
      }

      // Format notification message
      const changesStr = changes.join(", ");

      // Send notification to all tokens
      // NOTE: Sending data-only message (no notification field) so the app
      // can handle display with custom styling based on type
      const message = {
        data: {
          type: "prayer",
          title: "📿 Prayer Time Update",
          body: changesStr,
          changes: JSON.stringify(changes),
        },
        tokens: tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      logger.info("✅ Iqamah change notifications sent", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
        changes: changes,
      });

      // Log failures
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            logger.warn("Failed to send to token", {
              token: tokens[idx].substring(0, 20) + "...",
              error: resp.error?.message,
            });
          }
        });
      }

    } catch (error: any) {
      logger.error("❌ Error sending iqamah change notifications:", error);
    }
  }
);
