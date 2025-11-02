// ============================================================================
// CLOUD FUNCTION: Send Notification on Event Created
// Location: functions/src/notifications/onEventCreated.ts
// ============================================================================

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

export const onEventCreated = onDocumentCreated(
  {
    document: "events/{eventId}",
    region: "australia-southeast1",
  },
  async (event) => {
    try {
      const eventData = event.data?.data();
      
      if (!eventData) {
        logger.error("No event data found");
        return;
      }

      logger.info("🎉 New event created, sending notifications...", {
        eventId: event.params.eventId,
        title: eventData.title,
      });

      // Get all users with notifications enabled
      const usersSnapshot = await admin.firestore()
        .collection("users")
        .where("notificationsEnabled", "==", true)
        .get();

      if (usersSnapshot.empty) {
        logger.info("No users with notifications enabled");
        return;
      }

      // Collect FCM tokens
      const tokens: string[] = [];
      usersSnapshot.forEach((doc) => {
        const userData = doc.data();
        if (userData.fcmToken) {
          tokens.push(userData.fcmToken);
        }
      });

      if (tokens.length === 0) {
        logger.info("No FCM tokens found");
        return;
      }

      // Format date if available
      const eventDate = eventData.date || eventData.start_date || "";
      const dateStr = eventDate ? ` - ${eventDate}` : "";

      // Send notification to all tokens
      // NOTE: Sending data-only message (no notification field) so the app
      // can handle display with custom styling based on type
      const message = {
        data: {
          type: "event",
          eventId: event.params.eventId,
          title: "🕌 New Event",
          body: `${eventData.title}${dateStr}`,
          eventTitle: eventData.title || "",
          date: eventDate,
        },
        tokens: tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      logger.info("✅ Event notifications sent", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
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
      logger.error("❌ Error sending event notifications:", error);
    }
  }
);
