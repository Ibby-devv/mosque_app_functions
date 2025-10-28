// ============================================================================
// CLOUD FUNCTION: Send Notification on Event Updated
// Location: functions/src/notifications/onEventUpdated.ts
// ============================================================================

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

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
      const eventDate = after.date || after.start_date || "";
      if (eventDate) {
        const today = new Date().toLocaleString('en-AU', {
          timeZone: 'Australia/Sydney',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        const [day, month, year] = today.split('/');
        const todayFormatted = `${year}-${month}-${day}`;
        
        if (eventDate < todayFormatted) {
          logger.info("Event is in the past, skipping notification");
          return;
        }
      }

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

      // Send notification to all tokens
      const message = {
        notification: {
          title: "📝 Event Updated",
          body: notificationBody,
        },
        data: {
          type: "event_updated",
          eventId: event.params.eventId,
          title: after.title || "",
          date: eventDate,
          changes: JSON.stringify(changes),
        },
        tokens: tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      logger.info("✅ Event update notifications sent", {
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
      logger.error("❌ Error sending event update notifications:", error);
    }
  }
);
