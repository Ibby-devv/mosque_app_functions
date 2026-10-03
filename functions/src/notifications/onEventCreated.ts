// ============================================================================
// CLOUD FUNCTION: Send Notification on Event Created
// Location: functions/src/notifications/onEventCreated.ts
// ============================================================================

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { getActiveTokens, cleanupInvalidTokens } from "../utils/tokenCleanup";
import { buildDataOnlyMessage, getMosqueTimezone } from "../utils/messagingHelpers";
import {
  civilDateFromMidnightInstant,
  formatCivilDateDisplay,
  formatClockDisplay,
  parseCivilDate,
  parseClock,
  weekdayLong,
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

function displayClock(data: Record<string, any>): string {
  const raw =
    (typeof data.event_time === "string" && data.event_time) ||
    (typeof data.time === "string" && data.time) ||
    "";
  if (!raw) return "";
  const minutes = parseClock(raw);
  if (minutes == null) return raw;
  // Prefer 12-hour display in notifications when we have a parseable clock
  return formatClockDisplay(minutes);
}

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

      logger.info("New event created, sending notifications...", {
        eventId: event.params.eventId,
        title: eventData.title,
      });

      const { tokens, deviceIds } = await getActiveTokens(90);

      if (tokens.length === 0) {
        logger.info("No active devices with notifications enabled");
        return;
      }

      const mosqueTimezone = await getMosqueTimezone();
      const day = resolveEventCivilDate(eventData, mosqueTimezone);
      const clock = displayClock(eventData);

      let when = "";
      if (day) {
        const dayLabel = `${weekdayLong(day, mosqueTimezone)}, ${formatCivilDateDisplay(day)}`;
        when = clock ? `${clock} on ${dayLabel}` : dayLabel;
      } else if (clock) {
        when = clock;
      }

      const messageData: Record<string, string> = {
        type: "event",
        eventId: event.params.eventId,
        title: eventData.title || "New event",
        body: eventData.location
          ? when
            ? `${when} · ${eventData.location}`
            : eventData.location
          : when,
        eventTitle: eventData.title || "",
        date: when,
        imageUrl: eventData.image_url || "",
      };

      const message = buildDataOnlyMessage(messageData, tokens);
      const response = await admin.messaging().sendEachForMulticast(message);
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
