// ============================================================================
// CLOUD FUNCTION: Send Notification on Event Created
// Location: functions/src/notifications/onEventCreated.ts
// ============================================================================

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { getActiveTokens, cleanupInvalidTokens } from "../utils/tokenCleanup";
import { buildDataOnlyMessage, timestampToString } from "../utils/messagingHelpers";

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

      // Get all active devices with notifications enabled
      const { tokens, deviceIds } = await getActiveTokens(90);

      if (tokens.length === 0) {
        logger.info("No active devices with notifications enabled");
        return;
      }

      // Format date if available
      const eventDate = timestampToString(eventData.date || eventData.start_date);
      const dateStr = eventDate ? ` - ${eventDate}` : "";

      // Send notification to all tokens
      // NOTE: Sending data-only message (no notification field) so the app
      // can handle display with custom styling based on type
      const messageData = {
        type: "event",
        eventId: event.params.eventId,
        title: "🕌 New Event",
        body: `${eventData.title}${dateStr}`,
        eventTitle: eventData.title || "",
        date: eventDate,
        imageUrl: eventData.image_url || "",
      };

      const message = buildDataOnlyMessage(messageData, tokens);

      const response = await admin.messaging().sendEachForMulticast(message);

      // Clean up invalid tokens
      await cleanupInvalidTokens(tokens, response.responses, deviceIds);

      logger.info("✅ Event notifications sent", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
      });

    } catch (error: any) {
      logger.error("❌ Error sending event notifications:", error);
    }
  }
);
