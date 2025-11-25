// ============================================================================
// CLOUD FUNCTION: Send Notification on Event Updated
// Location: functions/src/notifications/onEventUpdated.ts
// ============================================================================

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { getActiveTokens, cleanupInvalidTokens } from "../utils/tokenCleanup";
import { buildDataOnlyMessage, timestampToString } from "../utils/messagingHelpers";

export const onEventUpdated = onDocumentUpdated(
  {
    document: "events/{eventId}",
    region: "australia-southeast1",
  },
  async (event) => {
    try {
      const before = event.data?.before.data();
      const after = event.data?.after.data();
      
      if (!before || !after) {
        logger.error("No event data found");
        return;
      }

      logger.info("📝 Event updated, checking for significant changes...", {
        eventId: event.params.eventId,
        title: after.title,
      });

      // Check if event is in the past - don't notify for past events
      if (after.date || after.start_date) {
        const eventTimestamp = after.date || after.start_date;
        const eventDate = eventTimestamp.toDate();
        const today = new Date();
        
        // Compare dates (ignore time)
        eventDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);
        
        if (eventDate < today) {
          logger.info("Event is in the past, skipping notification");
          return;
        }
      }
      
      // Format event date for notification
      const eventDate = timestampToString(after.date || after.start_date);

      // Track significant changes
      const changes: string[] = [];

      // Check important fields and build user-friendly messages
      let notificationBody = "";
      
      if (before.title !== after.title) {
        changes.push(`Title: ${before.title} → ${after.title}`);
      }

      // Check if event was cancelled or reactivated first (most important)
      if (before.is_active !== after.is_active) {
        if (!after.is_active) {
          changes.push("Event has been cancelled");
          notificationBody = `${after.title} has been cancelled`;
        } else {
          changes.push("Event has been reactivated");
          notificationBody = `${after.title} has been reactivated`;
          if (after.date && after.time) {
            notificationBody += ` - ${after.date} at ${after.time}`;
          }
        }
      }

      // Date change
      if (before.date !== after.date) {
        changes.push(`Date: ${before.date} → ${after.date}`);
        if (!notificationBody) {
          notificationBody = `${after.title} rescheduled to ${after.date}`;
          if (after.time) {
            notificationBody += ` at ${after.time}`;
          }
        }
      }

      // Time change
      if (before.time !== after.time) {
        changes.push(`Time: ${before.time} → ${after.time}`);
        if (!notificationBody && after.time) {
          notificationBody = `${after.title} time changed to ${after.time}`;
          if (after.date) {
            notificationBody += ` on ${after.date}`;
          }
        }
      }

      // Location change
      if (before.location !== after.location && (before.location || after.location)) {
        changes.push(`Location: ${before.location || 'Not set'} → ${after.location || 'Not set'}`);
        if (!notificationBody && after.location) {
          notificationBody = `${after.title} location changed to ${after.location}`;
        }
      }

      // Speaker change
      if (before.speaker !== after.speaker && (before.speaker || after.speaker)) {
        changes.push(`Speaker: ${before.speaker || 'Not set'} → ${after.speaker || 'Not set'}`);
        if (!notificationBody && after.speaker) {
          notificationBody = `${after.title} speaker: ${after.speaker}`;
        }
      }

      // If no significant changes, don't send notification
      if (changes.length === 0) {
        logger.info("No significant changes detected (description/image may have changed)");
        return;
      }

      // Fallback if multiple changes
      if (!notificationBody) {
        notificationBody = `${after.title} - ${changes.length} updates made`;
      }

      logger.info("📣 Significant event changes detected:", { changes, notificationBody });

      // Get all active devices with notifications enabled
      const { tokens, deviceIds } = await getActiveTokens(90);

      if (tokens.length === 0) {
        logger.info("No active devices with notifications enabled");
        return;
      }

      // Send notification to all tokens
      // NOTE: Sending data-only message (no notification field) so the app
      // can handle display with custom styling based on type
      const messageData = {
        type: "event",
        eventId: event.params.eventId,
        title: "📝 Event Updated",
        body: notificationBody,
        eventTitle: after.title || "",
        date: eventDate,
        changes: JSON.stringify(changes),
        imageUrl: after.image_url || "",
      };

      const message = buildDataOnlyMessage(messageData, tokens);

      const response = await admin.messaging().sendEachForMulticast(message);

      // Clean up invalid tokens
      await cleanupInvalidTokens(tokens, response.responses, deviceIds);

      logger.info("✅ Event update notifications sent", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
        changes: changes,
      });

    } catch (error: any) {
      logger.error("❌ Error sending event update notifications:", error);
    }
  }
);
