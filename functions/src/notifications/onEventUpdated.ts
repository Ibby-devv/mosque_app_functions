// ============================================================================
// CLOUD FUNCTION: Send Notification on Event Updated
// Location: functions/src/notifications/onEventUpdated.ts
// ============================================================================

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { getActiveTokens, cleanupInvalidTokens } from "../utils/tokenCleanup";
import { buildDataOnlyMessage, getMosqueTimezone } from "../utils/messagingHelpers";
import {
  formatCivilDateDisplay,
  isEventPastAt,
  parseCivilDate,
  weekdayLong,
  civilDateFromMidnightInstant,
  type CalendarDate,
} from "../utils/iqamaSchedule";

function resolveEventCivilDate(
  data: Record<string, any>,
  mosqueTimezone: string
): CalendarDate | null {
  if (typeof data.event_date === "string") {
    return parseCivilDate(data.event_date);
  }
  const legacy = data.date || data.start_date;
  if (legacy?.toDate) {
    return civilDateFromMidnightInstant(legacy.toDate(), mosqueTimezone);
  }
  return null;
}

function formatEventDayLabel(
  data: Record<string, any>,
  mosqueTimezone: string
): string {
  const day = resolveEventCivilDate(data, mosqueTimezone);
  if (!day) return "";
  return `${weekdayLong(day, mosqueTimezone)}, ${formatCivilDateDisplay(day)}`;
}

function eventClock(data: Record<string, any>): string {
  if (typeof data.event_time === "string" && data.event_time) {
    return data.event_time;
  }
  if (typeof data.time === "string" && data.time) {
    return data.time;
  }
  return "";
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

      logger.info("Event updated, checking for significant changes...", {
        eventId: event.params.eventId,
        title: after.title,
      });

      const mosqueTimezone = await getMosqueTimezone();

      const hasSchedule =
        after.event_date || after.date || after.start_date || after.event_time || after.time;
      if (hasSchedule) {
        const legacyTs = after.date || after.start_date;
        if (
          isEventPastAt({
            now: new Date(),
            timeZone: mosqueTimezone,
            eventDate: typeof after.event_date === "string" ? after.event_date : null,
            eventTime: typeof after.event_time === "string" ? after.event_time : null,
            legacyDate: legacyTs?.toDate ? legacyTs.toDate() : null,
            legacyTime: typeof after.time === "string" ? after.time : null,
          })
        ) {
          logger.info("Event is in the past, skipping notification");
          return;
        }
      }

      const eventDate = formatEventDayLabel(after, mosqueTimezone);
      const afterClock = eventClock(after);
      const beforeClock = eventClock(before);

      const changes: string[] = [];
      let notificationBody = "";

      if (before.title !== after.title) {
        changes.push(`Title: ${before.title} → ${after.title}`);
      }

      if (before.is_active !== after.is_active) {
        if (!after.is_active) {
          changes.push("Event has been cancelled");
          notificationBody = `${after.title} has been cancelled`;
        } else {
          changes.push("Event has been reactivated");
          notificationBody = `${after.title} has been reactivated`;
          if (eventDate && afterClock) {
            notificationBody += ` - ${eventDate} at ${afterClock}`;
          }
        }
      }

      const beforeDay = resolveEventCivilDate(before, mosqueTimezone);
      const afterDay = resolveEventCivilDate(after, mosqueTimezone);
      const dateChanged =
        beforeDay &&
        afterDay &&
        (beforeDay.year !== afterDay.year ||
          beforeDay.month !== afterDay.month ||
          beforeDay.day !== afterDay.day);

      if (dateChanged) {
        const beforeDate = formatEventDayLabel(before, mosqueTimezone);
        changes.push(`Date: ${beforeDate} → ${eventDate}`);
        if (!notificationBody) {
          notificationBody = `${after.title} rescheduled to ${eventDate}`;
          if (afterClock) {
            notificationBody += ` at ${afterClock}`;
          }
        }
      }

      if (beforeClock !== afterClock) {
        changes.push(`Time: ${beforeClock || "Not set"} → ${afterClock || "Not set"}`);
        if (!notificationBody && afterClock) {
          notificationBody = `${after.title} time changed to ${afterClock}`;
          if (eventDate) {
            notificationBody += ` on ${eventDate}`;
          }
        }
      }

      if (before.location !== after.location && (before.location || after.location)) {
        changes.push(
          `Location: ${before.location || "Not set"} → ${after.location || "Not set"}`
        );
        if (!notificationBody && after.location) {
          notificationBody = `${after.title} location changed to ${after.location}`;
        }
      }

      if (before.speaker !== after.speaker && (before.speaker || after.speaker)) {
        changes.push(
          `Speaker: ${before.speaker || "Not set"} → ${after.speaker || "Not set"}`
        );
        if (!notificationBody && after.speaker) {
          notificationBody = `${after.title} speaker: ${after.speaker}`;
        }
      }

      if (changes.length === 0) {
        logger.info("No significant changes detected (description/image may have changed)");
        return;
      }

      if (!notificationBody) {
        notificationBody = `${after.title} - ${changes.length} updates made`;
      }

      logger.info("Significant event changes detected:", { changes, notificationBody });

      const { tokens, deviceIds } = await getActiveTokens(90);

      if (tokens.length === 0) {
        logger.info("No active devices with notifications enabled");
        return;
      }

      const messageData = {
        type: "event",
        eventId: event.params.eventId,
        title: after.title || "Event updated",
        body: notificationBody,
        eventTitle: after.title || "",
        date: eventDate,
        changes: JSON.stringify(changes),
        imageUrl: after.image_url || "",
      };

      const message = buildDataOnlyMessage(messageData, tokens);
      const response = await admin.messaging().sendEachForMulticast(message);
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
