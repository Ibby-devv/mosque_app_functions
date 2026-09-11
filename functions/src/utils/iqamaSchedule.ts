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

export function getZonedDateTimeParts(date: Date, timeZone: string): ZonedDateTime {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  let hour = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  // formatToParts can return 24 for midnight
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
 * Midnight in the mosque timezone as UTC millis.
 *
 * Uses the same offset construction as the original create/process functions
 * so stored `effectiveDate` timestamps still match scheduler queries.
 */
export function mosqueMidnightMillis(
  year: number,
  month: number,
  day: number,
  mosqueTimezone: string
): number {
  const dateStr =
    `${year}-${month.toString().padStart(2, "0")}-` +
    `${day.toString().padStart(2, "0")}T00:00:00`;
  const tempDate = new Date(dateStr);
  const dateInMosqueTz = new Date(
    tempDate.toLocaleString("en-US", { timeZone: mosqueTimezone })
  );
  const utcOffset = tempDate.getTime() - dateInMosqueTz.getTime();
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime() + utcOffset;
}

/**
 * Parse a 12-hour time string (e.g. "5:30 AM") to minutes since midnight.
 */
export function parseTimeToMinutes(timeStr: string): number | null {
  try {
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

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
