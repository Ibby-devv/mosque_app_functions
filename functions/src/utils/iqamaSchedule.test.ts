import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IQAMA_CHANGE_APPLY_BUFFER_MINUTES,
  addCalendarDays,
  applyAfterMinuteOfDay,
  classifyEffectiveDate,
  decideScheduledIqamaApply,
  getZonedDateTimeParts,
  mosqueMidnightMillis,
  parseTimeToMinutes,
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
});

describe("parseTimeToMinutes", () => {
  it("parses 12-hour times", () => {
    assert.equal(parseTimeToMinutes("5:30 AM"), 5 * 60 + 30);
    assert.equal(parseTimeToMinutes("12:00 AM"), 0);
    assert.equal(parseTimeToMinutes("12:00 PM"), 12 * 60);
    assert.equal(parseTimeToMinutes("7:15 PM"), 19 * 60 + 15);
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

