import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IQAMA_CHANGE_APPLY_BUFFER_MINUTES,
  addCalendarDays,
  applyAfterMinuteOfDay,
  civilDateFromMidnightInstant,
  classifyEffectiveDate,
  decideScheduledIqamaApply,
  formatCivilDate,
  formatCivilDateDisplay,
  formatClock,
  formatClockDisplay,
  formatInstantDisplay,
  getZonedDateTimeParts,
  isEventPastAt,
  mosqueMidnightMillis,
  parseCivilDate,
  parseClock,
  parseTimeToMinutes,
  resolveEffectiveCivilDate,
  zonedDateTimeToUtcMillis,
} from "./iqamaSchedule";

describe("addCalendarDays", () => {
  it("adds a day within a month", () => {
    assert.deepEqual(addCalendarDays(2026, 9, 11, 1), {
      year: 2026,
      month: 9,
      day: 12,
    });
  });

  it("rolls 31 Jan to 1 Feb", () => {
    assert.deepEqual(addCalendarDays(2026, 1, 31, 1), {
      year: 2026,
      month: 2,
      day: 1,
    });
  });

  it("rolls 31 Dec to 1 Jan of next year", () => {
    assert.deepEqual(addCalendarDays(2026, 12, 31, 1), {
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it("rolls 28 Feb of a non-leap year to 1 Mar", () => {
    assert.deepEqual(addCalendarDays(2026, 2, 28, 1), {
      year: 2026,
      month: 3,
      day: 1,
    });
  });

  it("rolls 31 Mar / May / Jul / Aug / Oct the same way", () => {
    assert.deepEqual(addCalendarDays(2026, 3, 31, 1), { year: 2026, month: 4, day: 1 });
    assert.deepEqual(addCalendarDays(2026, 5, 31, 1), { year: 2026, month: 6, day: 1 });
    assert.deepEqual(addCalendarDays(2026, 7, 31, 1), { year: 2026, month: 8, day: 1 });
    assert.deepEqual(addCalendarDays(2026, 8, 31, 1), { year: 2026, month: 9, day: 1 });
    assert.deepEqual(addCalendarDays(2026, 10, 31, 1), { year: 2026, month: 11, day: 1 });
  });
});

describe("mosqueMidnightMillis", () => {
  const tz = "Australia/Sydney";

  it("matches create and process for mid-month dates", () => {
    const created = mosqueMidnightMillis(2026, 9, 12, tz);
    const fromRollover = addCalendarDays(2026, 9, 11, 1);
    const processed = mosqueMidnightMillis(
      fromRollover.year,
      fromRollover.month,
      fromRollover.day,
      tz
    );
    assert.equal(created, processed);
    assert.equal(new Date(created).toISOString(), "2026-09-11T14:00:00.000Z");
  });

  it("matches across month-end so 1 Feb schedules are found on 31 Jan", () => {
    const created = mosqueMidnightMillis(2026, 2, 1, tz);
    const tomorrow = addCalendarDays(2026, 1, 31, 1);
    const processed = mosqueMidnightMillis(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      tz
    );
    assert.equal(tomorrow.month, 2);
    assert.equal(tomorrow.day, 1);
    assert.equal(created, processed);
    assert.ok(!Number.isNaN(processed));
  });

  it("matches across year-end so 1 Jan schedules are found on 31 Dec", () => {
    const created = mosqueMidnightMillis(2027, 1, 1, tz);
    const tomorrow = addCalendarDays(2026, 12, 31, 1);
    const processed = mosqueMidnightMillis(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      tz
    );
    assert.equal(created, processed);
    assert.ok(!Number.isNaN(processed));
  });

  it("stores the Sunday DST-start midnight, not 23:00 the evening before", () => {
    // 4 Oct 2026 is the first Sunday; clocks jump 02:00 → 03:00.
    // Local midnight is still AEST (UTC+10) → 2026-10-03T14:00:00.000Z.
    const millis = mosqueMidnightMillis(2026, 10, 4, tz);
    assert.equal(new Date(millis).toISOString(), "2026-10-03T14:00:00.000Z");
    const parts = getZonedDateTimeParts(new Date(millis), tz);
    assert.deepEqual(
      { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute },
      { year: 2026, month: 10, day: 4, hour: 0, minute: 0 }
    );
  });

  it("stores the Sunday DST-end midnight, not 01:00", () => {
    // 5 Apr 2026 is the first Sunday; clocks fall 03:00 → 02:00.
    // Local midnight is still AEDT (UTC+11) → 2026-04-04T13:00:00.000Z.
    const millis = mosqueMidnightMillis(2026, 4, 5, tz);
    assert.equal(new Date(millis).toISOString(), "2026-04-04T13:00:00.000Z");
    const parts = getZonedDateTimeParts(new Date(millis), tz);
    assert.equal(parts.day, 5);
    assert.equal(parts.hour, 0);
    assert.equal(parts.minute, 0);
  });
});

describe("civil dates", () => {
  const tz = "Australia/Sydney";

  it("round-trips a YYYY-MM-DD string without an instant", () => {
    const parsed = parseCivilDate("2026-10-04");
    assert.deepEqual(parsed, { year: 2026, month: 10, day: 4 });
    assert.equal(formatCivilDate(parsed!), "2026-10-04");
    assert.equal(parseCivilDate("2026-02-31"), null);
  });

  it("decodes a real local midnight back to that calendar day", () => {
    for (const [year, month, day] of [
      [2026, 9, 12],
      [2026, 10, 4],
      [2026, 4, 5],
      [2027, 1, 1],
    ] as const) {
      const instant = new Date(mosqueMidnightMillis(year, month, day, tz));
      assert.deepEqual(civilDateFromMidnightInstant(instant, tz), { year, month, day });
    }
  });

  it("reads the old October DST instant as the Sunday it was meant to encode", () => {
    // Previous offset math stored 4 Oct 2026 midnight as Saturday 23:00.
    const day = civilDateFromMidnightInstant(
      new Date("2026-10-03T13:00:00.000Z"),
      tz
    );
    assert.deepEqual(day, { year: 2026, month: 10, day: 4 });
    assert.deepEqual(
      resolveEffectiveCivilDate("2026-10-04", tz),
      { year: 2026, month: 10, day: 4 }
    );
  });

  it("reads the old April DST instant as the Sunday it was meant to encode", () => {
    const day = civilDateFromMidnightInstant(
      new Date("2026-04-04T14:00:00.000Z"),
      tz
    );
    assert.deepEqual(day, { year: 2026, month: 4, day: 5 });
  });
});

describe("parseTimeToMinutes", () => {
  it("parses 12-hour times", () => {
    assert.equal(parseTimeToMinutes("5:30 AM"), 5 * 60 + 30);
    assert.equal(parseTimeToMinutes("12:00 AM"), 0);
    assert.equal(parseTimeToMinutes("12:00 PM"), 12 * 60);
    assert.equal(parseTimeToMinutes("7:15 PM"), 19 * 60 + 15);
  });

  it("rejects strings that are not a single clock time", () => {
    assert.equal(parseTimeToMinutes("5:45:00 AM"), null);
    assert.equal(parseTimeToMinutes("25:00 AM"), null);
    assert.equal(parseTimeToMinutes(""), null);
  });
});

describe("applyAfterMinuteOfDay", () => {
  it("uses the later of today and new Iqama plus 30 minutes", () => {
    const todayIsha = parseTimeToMinutes("7:15 PM")!;
    const newIsha = parseTimeToMinutes("7:30 PM")!;
    assert.equal(
      applyAfterMinuteOfDay(todayIsha, newIsha),
      newIsha + IQAMA_CHANGE_APPLY_BUFFER_MINUTES
    );
  });

  it("waits for today's later Iqama when the new time is earlier", () => {
    const todayIsha = parseTimeToMinutes("7:30 PM")!;
    const newIsha = parseTimeToMinutes("7:15 PM")!;
    assert.equal(
      applyAfterMinuteOfDay(todayIsha, newIsha),
      todayIsha + IQAMA_CHANGE_APPLY_BUFFER_MINUTES
    );
  });

  it("caps a late-night buffer so it still applies before midnight", () => {
    const late = parseTimeToMinutes("11:50 PM")!;
    assert.equal(applyAfterMinuteOfDay(late, late), 24 * 60 - 15);
  });
});

describe("decideScheduledIqamaApply", () => {
  const fajr530 = parseTimeToMinutes("5:30 AM")!;
  const fajr545 = parseTimeToMinutes("5:45 AM")!;
  const isha715 = parseTimeToMinutes("7:15 PM")!;
  const isha730 = parseTimeToMinutes("7:30 PM")!;

  it("does not apply Isha at the old Iqama time (avoids countdown restart)", () => {
    const decision = decideScheduledIqamaApply({
      currentMinutes: isha715,
      todayIqamaMinutes: isha715,
      newIqamaMinutes: isha730,
      effectiveDateKind: "tomorrow",
    });
    assert.equal(decision.action, "wait");
  });

  it("does not apply Isha at the new Iqama time either", () => {
    const decision = decideScheduledIqamaApply({
      currentMinutes: isha730,
      todayIqamaMinutes: isha715,
      newIqamaMinutes: isha730,
      effectiveDateKind: "tomorrow",
    });
    assert.equal(decision.action, "wait");
  });

  it("applies Isha 30 minutes after the later time", () => {
    const decision = decideScheduledIqamaApply({
      currentMinutes: isha730 + IQAMA_CHANGE_APPLY_BUFFER_MINUTES,
      todayIqamaMinutes: isha715,
      newIqamaMinutes: isha730,
      effectiveDateKind: "tomorrow",
    });
    assert.equal(decision.action, "apply");
  });

  it("does not apply an earlier Fajr at today's later Iqama", () => {
    // Tomorrow is 5:45, today is 6:00. Writing at 6:00 puts 5:45 before now
    // and the countdown leaves today's congregation.
    const atToday = decideScheduledIqamaApply({
      currentMinutes: parseTimeToMinutes("6:00 AM")!,
      todayIqamaMinutes: parseTimeToMinutes("6:00 AM")!,
      newIqamaMinutes: fajr545,
      effectiveDateKind: "tomorrow",
    });
    assert.equal(atToday.action, "wait");

    const afterBuffer = decideScheduledIqamaApply({
      currentMinutes: parseTimeToMinutes("6:30 AM")!,
      todayIqamaMinutes: parseTimeToMinutes("6:00 AM")!,
      newIqamaMinutes: fajr545,
      effectiveDateKind: "tomorrow",
    });
    assert.equal(afterBuffer.action, "apply");
  });

  it("keeps the 30-minute buffer for a DST-shifted Sunday Fajr on Saturday morning", () => {
    const effectiveDay = civilDateFromMidnightInstant(
      new Date("2026-10-03T13:00:00.000Z"),
      "Australia/Sydney"
    );
    const saturday = { year: 2026, month: 10, day: 3 };
    const kind = classifyEffectiveDate(effectiveDay, saturday);
    assert.equal(kind, "tomorrow");

    const atFajr = decideScheduledIqamaApply({
      currentMinutes: parseTimeToMinutes("5:45 AM")!,
      todayIqamaMinutes: parseTimeToMinutes("6:00 AM")!,
      newIqamaMinutes: fajr545,
      effectiveDateKind: kind,
    });
    assert.equal(atFajr.action, "wait");
    assert.equal(atFajr.applyAfterMinutes, parseTimeToMinutes("6:30 AM"));
  });

  it("applies Fajr after both times plus buffer so the rest of the day shows tomorrow", () => {
    const atFajr = decideScheduledIqamaApply({
      currentMinutes: fajr530,
      todayIqamaMinutes: fajr530,
      newIqamaMinutes: fajr545,
      effectiveDateKind: "tomorrow",
    });
    assert.equal(atFajr.action, "wait");

    const afterBuffer = decideScheduledIqamaApply({
      currentMinutes: fajr545 + IQAMA_CHANGE_APPLY_BUFFER_MINUTES,
      todayIqamaMinutes: fajr530,
      newIqamaMinutes: fajr545,
      effectiveDateKind: "tomorrow",
    });
    assert.equal(afterBuffer.action, "apply");
  });

  it("applies immediately as catch-up on the effective date", () => {
    const decision = decideScheduledIqamaApply({
      currentMinutes: 5,
      todayIqamaMinutes: fajr530,
      newIqamaMinutes: fajr545,
      effectiveDateKind: "past_or_today",
    });
    assert.equal(decision.action, "apply");
    assert.match(decision.reason, /catch-up/);
  });

  it("skips dates after tomorrow", () => {
    const decision = decideScheduledIqamaApply({
      currentMinutes: 12 * 60,
      todayIqamaMinutes: fajr530,
      newIqamaMinutes: fajr545,
      effectiveDateKind: "later",
    });
    assert.equal(decision.action, "skip");
  });
});

describe("getZonedDateTimeParts midnight hour", () => {
  it("does not treat hour 24 as 24:00", () => {
    // 2026-09-11 14:00 UTC is midnight AEST
    const parts = getZonedDateTimeParts(
      new Date("2026-09-11T14:00:00.000Z"),
      "Australia/Sydney"
    );
    assert.equal(parts.hour, 0);
    assert.equal(parts.day, 12);
  });
});

describe("classifyEffectiveDate", () => {
  it("treats 1 Feb as tomorrow on 31 Jan", () => {
    assert.equal(
      classifyEffectiveDate(
        { year: 2026, month: 2, day: 1 },
        { year: 2026, month: 1, day: 31 }
      ),
      "tomorrow"
    );
  });

  it("treats 1 Jan as tomorrow on 31 Dec", () => {
    assert.equal(
      classifyEffectiveDate(
        { year: 2027, month: 1, day: 1 },
        { year: 2026, month: 12, day: 31 }
      ),
      "tomorrow"
    );
  });

  it("does not treat 2 Feb as tomorrow on 31 Jan", () => {
    assert.equal(
      classifyEffectiveDate(
        { year: 2026, month: 2, day: 2 },
        { year: 2026, month: 1, day: 31 }
      ),
      "later"
    );
  });
});

describe("display and clock helpers", () => {
  const tz = "Australia/Sydney";

  it("formats 4 October 2026 as DD-MM-YYYY not slash or ISO", () => {
    const display = formatCivilDateDisplay({ year: 2026, month: 10, day: 4 });
    assert.equal(display, "04-10-2026");
    assert.notEqual(display, "10/04/2026");
    assert.notEqual(display, "04/10/2026");
    assert.notEqual(display, "2026-10-04");
  });

  it("formats an instant as DD-MM-YYYY HH:mm without hour 24", () => {
    // 4 Oct 2026 14:30 AEDT (UTC+11)
    const instant = new Date(zonedDateTimeToUtcMillis(2026, 10, 4, 14, 30, tz));
    assert.equal(formatInstantDisplay(instant, tz), "04-10-2026 14:30");

    const midnight = new Date("2026-09-11T14:00:00.000Z"); // 12 Sep 00:00 AEST
    assert.equal(formatInstantDisplay(midnight, tz), "12-09-2026 00:00");
  });

  it("parses HH:mm and h:mm AM/PM", () => {
    assert.equal(parseClock("14:30"), 14 * 60 + 30);
    assert.equal(parseClock("2:30 PM"), 14 * 60 + 30);
    assert.equal(parseClock("5:45 AM"), 5 * 60 + 45);
    assert.equal(parseClock("24:00"), null);
    assert.equal(formatClock(14 * 60 + 30), "14:30");
    assert.equal(formatClockDisplay(5 * 60 + 45), "5:45 AM");
  });
});

describe("isEventPastAt", () => {
  const tz = "Australia/Sydney";

  it("treats 14:30 as not past at 10:00 the same civil day", () => {
    const now = new Date(zonedDateTimeToUtcMillis(2026, 10, 4, 10, 0, tz));
    assert.equal(
      isEventPastAt({
        now,
        timeZone: tz,
        eventDate: "2026-10-04",
        eventTime: "14:30",
      }),
      false
    );
  });

  it("treats 14:30 as past at 15:00 the same civil day", () => {
    const now = new Date(zonedDateTimeToUtcMillis(2026, 10, 4, 15, 0, tz));
    assert.equal(
      isEventPastAt({
        now,
        timeZone: tz,
        eventDate: "2026-10-04",
        eventTime: "14:30",
      }),
      true
    );
  });

  it("decodes a legacy midnight instant for the civil day", () => {
    const now = new Date(zonedDateTimeToUtcMillis(2026, 10, 4, 10, 0, tz));
    const legacy = new Date(mosqueMidnightMillis(2026, 10, 4, tz));
    assert.equal(
      isEventPastAt({
        now,
        timeZone: tz,
        legacyDate: legacy,
        legacyTime: "2:30 PM",
      }),
      false
    );
  });
});

