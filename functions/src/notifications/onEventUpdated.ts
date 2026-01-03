// ============================================================================
// CLOUD FUNCTION: Send Notification on Event Updated
// Location: functions/src/notifications/onEventUpdated.ts
// ============================================================================

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { getActiveTokens, cleanupInvalidTokens } from "../utils/tokenCleanup";
import { buildDataOnlyMessage, timestampToString } from "../utils/messagingHelpers";

/**
 * Get mosque timezone from Firestore settings (with caching)
 * Falls back to Australia/Sydney if not configured
 */
async function getMosqueTimezone(): Promise<string> {
  try {
    const db = admin.firestore();
    const settingsDoc = await db.collection('mosqueSettings').doc('info').get();
    const timezone = settingsDoc.data()?.timezone;
    
    if (timezone && typeof timezone === 'string') {
      return timezone;
    }
  } catch (error) {
    logger.warn('Could not fetch mosque timezone, using default:', error);
  }

  // Default fallback
  return 'Australia/Sydney';
}

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

      // Get mosque timezone once for all date operations
      const mosqueTimezone = await getMosqueTimezone();

      // Check if event is in the past - don't notify for past events
      if (after.date || after.start_date) {
        const eventTimestamp = after.date || after.start_date;
        const eventDate = eventTimestamp.toDate();
        
        // Get current time in mosque timezone
        const nowInMosqueTimezone = new Date(new Date().toLocaleString("en-US", { timeZone: mosqueTimezone }));
        
        // If event has a specific time, we need to parse it and compare with current time
        // Otherwise just compare dates (for all-day events)
        if (after.time && typeof after.time === 'string') {
          // Parse time string (e.g., "14:30" or "2:30 PM")
          const timeParts = after.time.match(/(\d+):(\d+)/);
          if (timeParts) {
            const hours = parseInt(timeParts[1], 10);
            const minutes = parseInt(timeParts[2], 10);
            
            // Adjust for AM/PM if present
            let adjustedHours = hours;
            if (after.time.toLowerCase().includes('pm') && hours !== 12) {
              adjustedHours = hours + 12;
            } else if (after.time.toLowerCase().includes('am') && hours === 12) {
              adjustedHours = 0;
            }
            
            eventDate.setHours(adjustedHours, minutes, 0, 0);
          }
        } else {
          // No specific time, compare dates only (set to end of day)
          eventDate.setHours(23, 59, 59, 999);
        }
        
        if (eventDate < nowInMosqueTimezone) {
          logger.info("Event is in the past, skipping notification", {
            eventDate: eventDate.toISOString(),
            currentTime: nowInMosqueTimezone.toISOString(),
          });
          return;
        }
      }
      
      // Format event date for notification
      // Format event date for notification (date only, no time)
      const eventTimestamp = after.date || after.start_date;
      const eventDateObj = eventTimestamp.toDate();
      const dayOfWeek = eventDateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: mosqueTimezone });
      const eventDateFull = await timestampToString(eventTimestamp);
      const eventDateOnly = eventDateFull.split(' ')[0];
      const eventDate = `${dayOfWeek}, ${eventDateOnly}`;

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
            notificationBody += ` - ${eventDate} at ${after.time}`;
          }
        }
      }

      // Date change
      if (before.date && after.date && before.date.toMillis() !== after.date.toMillis()) {
        const beforeDateObj = before.date.toDate();
        const beforeDayOfWeek = beforeDateObj.toLocaleDateString('en-US', { weekday: 'long', timeZone: mosqueTimezone });
        const beforeDateFull = await timestampToString(before.date);
        const beforeDateOnly = beforeDateFull.split(' ')[0];
        const beforeDate = `${beforeDayOfWeek}, ${beforeDateOnly}`;
        changes.push(`Date: ${beforeDate} → ${eventDate}`);
        if (!notificationBody) {
          notificationBody = `${after.title} rescheduled to ${eventDate}`;
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
            notificationBody += ` on ${eventDate}`;
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
        title: after.title || "📝 Event Updated",
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
