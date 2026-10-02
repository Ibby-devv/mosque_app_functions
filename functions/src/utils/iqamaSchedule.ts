// ============================================================================
// Helpers for scheduled Iqama change timing
// ============================================================================

/** Minutes to wait after the later of today's Iqama and the new Iqama. */
export const IQAMA_CHANGE_APPLY_BUFFER_MINUTES = 30;

const MINUTES_PER_DAY = 24 * 60;
/** Last scheduler tick of the day is :45; cap so late-night buffers still apply on D-1. */
const LATEST_APPLY_MINUTE_OF_DAY = MINUTES_PER_DAY - 15;

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface ZonedDateTime extends CalendarDate {
  hour: number;
  minute: number;
}

export type IqamaApplyAction = "apply" | "wait" | "skip";

export interface IqamaApplyDecision {
  action: IqamaApplyAction;
  reason: string;
  applyAfterMinutes?: number;
}

/**
 * Add calendar days using UTC so month/year rollover is correct
 * (Jan 31 + 1 → Feb 1, Dec 31 + 1 → Jan 1).
 */
export function addCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number
): CalendarDate {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/** Civil date, `YYYY-MM-DD`. This is a calendar day, not an instant. */
export function formatCivilDate(date: CalendarDate): string {
  const month = date.month.toString().padStart(2, "0");
  const day = date.day.toString().padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

export function parseCivilDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function getZonedDateTimeParts(date: Date, timeZone: string): ZonedDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  let hour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  // Some ICU builds still report midnight as 24
  if (hour === 24) hour = 0;

  return {
    year: parseInt(parts.find((p) => p.type === "year")!.value, 10),
    month: parseInt(parts.find((p) => p.type === "month")!.value, 10),
    day: parseInt(parts.find((p) => p.type === "day")!.value, 10),
    hour,
    minute: parseInt(parts.find((p) => p.type === "minute")!.value, 10),
  };
}

/**
 * UTC offset of `date` in `timeZone`, in minutes east of UTC.
 * Positive for Australia/Sydney (UTC+10 / UTC+11).
 */
function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = getZonedDateTimeParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    0,
    0
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * UTC millis for a civil date and clock time in an IANA timezone.
 *
 * The offset is read at the candidate instant, then once more at the
 * result. On a daylight-saving transition the offset at 00:00 UTC is not
 * the offset at local midnight, so a single sample stores the wrong day.
 */
export function zonedDateTimeToUtcMillis(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset = timeZoneOffsetMinutes(new Date(utcGuess), timeZone);
  let millis = utcGuess - offset * 60 * 1000;
  const offsetAtResult = timeZoneOffsetMinutes(new Date(millis), timeZone);
  if (offsetAtResult !== offset) {
    millis = utcGuess - offsetAtResult * 60 * 1000;
  }
  return millis;
}

/**
 * Local midnight as a UTC instant.
 *
 * Scheduled changes do not store this. A civil date is a `YYYY-MM-DD`
 * string. This conversion exists for older documents that encoded the date
 * as an instant, and for clients that still display `new Date(millis)`.
 */
export function mosqueMidnightMillis(
  year: number,
  month: number,
  day: number,
  mosqueTimezone: string
): number {
  return zonedDateTimeToUtcMillis(year, month, day, 0, 0, mosqueTimezone);
}

/**
 * Civil date encoded by an instant that was meant to be local midnight.
 *
 * A correct midnight decodes to that calendar day. An older writer sampled
 * the wrong UTC offset on DST-change days and missed midnight by an hour
 * (23:00 the evening before, or 01:00). The date those writes were encoding
 * is the calendar day whose true local midnight is closest to the instant.
 */
export function civilDateFromMidnightInstant(
  instant: Date,
  timeZone: string
): CalendarDate {
  const parts = getZonedDateTimeParts(instant, timeZone);
  const stampedDay: CalendarDate = {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  };
  if (parts.hour === 0 && parts.minute === 0) {
    return stampedDay;
  }

  const instantMs = instant.getTime();
  const candidates = [
    addCalendarDays(stampedDay.year, stampedDay.month, stampedDay.day, -1),
    stampedDay,
    addCalendarDays(stampedDay.year, stampedDay.month, stampedDay.day, 1),
  ];

  let best = stampedDay;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const midnight = mosqueMidnightMillis(
      candidate.year,
      candidate.month,
      candidate.day,
      timeZone
    );
    const distance = Math.abs(midnight - instantMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * Read a stored effective date.
 *
 * New documents store `YYYY-MM-DD`. Older documents store a Timestamp of
 * local midnight; those are decoded back to the civil date they encode.
 */
export function resolveEffectiveCivilDate(
  stored: string | Date,
  timeZone: string
): CalendarDate | null {
  if (typeof stored === "string") {
    return parseCivilDate(stored);
  }
  if (Number.isNaN(stored.getTime())) {
    return null;
  }
  return civilDateFromMidnightInstant(stored, timeZone);
}

/**
 * Parse a 12-hour time string (e.g. "5:30 AM") to minutes since midnight.
 */
/**
 * Parse a civil clock time. Storage and the app use 12-hour strings
 * (`5:45 AM`); this does not interpret them in a timezone.
 */
export function parseTimeToMinutes(timeStr: string): number | null {
  try {
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();
    if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;

    if (period === "PM" && hours !== 12) {
      hours += 12;
    } else if (period === "AM" && hours === 12) {
      hours = 0;
    }

    return hours * 60 + minutes;
  } catch {
    return null;
  }
}

export function minutesSinceMidnight(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * Earliest minute-of-day the change may be written on the day before
 * effectiveDate: max(today's Iqama, new Iqama) + buffer, capped so a
 * late Isha + buffer still applies before midnight.
 */
export function applyAfterMinuteOfDay(
  todayIqamaMinutes: number,
  newIqamaMinutes: number,
  bufferMinutes: number = IQAMA_CHANGE_APPLY_BUFFER_MINUTES
): number {
  return Math.min(
    Math.max(todayIqamaMinutes, newIqamaMinutes) + bufferMinutes,
    LATEST_APPLY_MINUTE_OF_DAY
  );
}

export type EffectiveDateKind = "past_or_today" | "tomorrow" | "later";

export function classifyEffectiveDate(
  effective: CalendarDate,
  today: CalendarDate
): EffectiveDateKind {
  if (compareCalendarDates(effective, today) <= 0) {
    return "past_or_today";
  }
  const tomorrow = addCalendarDays(today.year, today.month, today.day, 1);
  if (compareCalendarDates(effective, tomorrow) === 0) {
    return "tomorrow";
  }
  return "later";
}

/**
 * Decide whether a scheduled Iqama change should be written now.
 *
 * - Tomorrow: wait until both today's Iqama and the new Iqama have passed,
 *   plus the apply buffer, so countdowns cannot restart and the rest of
 *   the day still shows tomorrow's time on the board.
 * - Today or earlier (missed run / month-end catch-up): apply immediately.
 * - Later than tomorrow: skip (should not be in the query result).
 */
export function decideScheduledIqamaApply(opts: {
  currentMinutes: number;
  todayIqamaMinutes: number | null;
  newIqamaMinutes: number | null;
  effectiveDateKind: EffectiveDateKind;
  bufferMinutes?: number;
}): IqamaApplyDecision {
  const buffer = opts.bufferMinutes ?? IQAMA_CHANGE_APPLY_BUFFER_MINUTES;

  if (opts.effectiveDateKind === "later") {
    return { action: "skip", reason: "effective date is after tomorrow" };
  }

  if (opts.effectiveDateKind === "past_or_today") {
    return {
      action: "apply",
      reason: "catch-up: effective date is today or in the past",
    };
  }

  if (opts.todayIqamaMinutes == null) {
    return { action: "wait", reason: "could not parse today's iqama time" };
  }
  if (opts.newIqamaMinutes == null) {
    return { action: "wait", reason: "could not parse scheduled iqama time" };
  }

  const applyAfter = applyAfterMinuteOfDay(
    opts.todayIqamaMinutes,
    opts.newIqamaMinutes,
    buffer
  );

  if (opts.currentMinutes >= applyAfter) {
    return {
      action: "apply",
      reason:
        `ready: current ${opts.currentMinutes}min >= max(today, new)+` +
        `${buffer}m cap (${applyAfter}min)`,
      applyAfterMinutes: applyAfter,
    };
  }

  return {
    action: "wait",
    reason:
      `waiting until ${applyAfter}min (max(today ${opts.todayIqamaMinutes}, ` +
      `new ${opts.newIqamaMinutes}) + ${buffer}m)`,
    applyAfterMinutes: applyAfter,
  };
}

export function formatMinuteOfDay(totalMinutes: number): string {
  const minutes = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${minute.toString().padStart(2, "0")} ${period}`;
}
