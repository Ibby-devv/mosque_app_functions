import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addMinutesToTime,
  computeAdhanTimes,
  dateForAdhanCalculation,
  formatPrayerTime,
  recomputeOffsetIqamas,
} from "./calculatePrayerTimes";

const SYDNEY = "Australia/Sydney";
const BRISBANE = "Australia/Brisbane";
/** Approximate Sydney CBD; DST behaviour is timezone formatting, not exact coords. */
const SYDNEY_LAT = -33.8688;
const SYDNEY_LNG = 151.2093;

function parseToMinutes(timeStr: string): number {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  assert.ok(match, `could not parse time: ${timeStr}`);
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function offsetLabel(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "numeric",
  }).formatToParts(instant);
  return parts.find((p) => p.type === "timeZoneName")!.value;
}

function timesFor(nowIso: string, timeZone: string) {
  return computeAdhanTimes(
    SYDNEY_LAT,
    SYDNEY_LNG,
    "MuslimWorldLeague",
    new Date(nowIso),
    timeZone
  );
}

describe("dateForAdhanCalculation", () => {
  it("uses the mosque calendar date at midnight AEST on DST start day", () => {
    // 4 Oct 2026 00:00 AEST (DST starts at 02:00 that morning)
    const date = dateForAdhanCalculation(
      new Date("2026-10-03T14:00:00.000Z"),
      SYDNEY
    );
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 9);
    assert.equal(date.getDate(), 4);
  });

  it("stays on 4 Oct after the 2 AM spring-forward", () => {
    // 4 Oct 2026 03:00 AEDT
    const date = dateForAdhanCalculation(
      new Date("2026-10-03T16:00:00.000Z"),
      SYDNEY
    );
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 9);
    assert.equal(date.getDate(), 4);
  });

  it("uses 5 Apr after DST ends at 3 AM", () => {
    // 5 Apr 2026 00:00 AEDT (clocks fall back at 03:00)
    const date = dateForAdhanCalculation(
      new Date("2026-04-04T13:00:00.000Z"),
      SYDNEY
    );
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 3);
    assert.equal(date.getDate(), 5);
  });
});

describe("formatPrayerTime Australian DST", () => {
  // Same solar-noon-ish UTC instant on consecutive days; civil clocks move with DST.
  const oct3Utc = new Date("2026-10-03T01:45:00.000Z");
  const oct4Utc = new Date("2026-10-04T01:45:00.000Z");

  it("formats AEST as GMT+10 and AEDT as GMT+11", () => {
    assert.equal(offsetLabel(oct3Utc, SYDNEY), "GMT+10");
    assert.equal(offsetLabel(oct4Utc, SYDNEY), "GMT+11");
  });

  it("shifts the displayed clock by one hour when DST starts", () => {
    assert.equal(formatPrayerTime(oct3Utc, SYDNEY), "11:45 AM");
    assert.equal(formatPrayerTime(oct4Utc, SYDNEY), "12:45 PM");
  });

  it("does not shift in Australia/Brisbane (no DST)", () => {
    assert.equal(formatPrayerTime(oct3Utc, BRISBANE), "11:45 AM");
    assert.equal(formatPrayerTime(oct4Utc, BRISBANE), "11:45 AM");
  });
});

describe("computeAdhanTimes Australian DST", () => {
  // Daily job fires at 00:00 Australia/Sydney.
  const midnightOct3Aest = "2026-10-02T14:00:00.000Z"; // 3 Oct 2026 00:00 AEST
  const midnightOct4Aest = "2026-10-03T14:00:00.000Z"; // 4 Oct 2026 00:00 AEST (DST starts 02:00)
  const midnightApr4Aedt = "2026-04-03T13:00:00.000Z"; // 4 Apr 2026 00:00 AEDT
  const midnightApr5Aedt = "2026-04-04T13:00:00.000Z"; // 5 Apr 2026 00:00 AEDT (DST ends 03:00)

  it("jumps displayed Dhuhr by about one hour when Sydney DST starts", () => {
    const before = timesFor(midnightOct3Aest, SYDNEY);
    const after = timesFor(midnightOct4Aest, SYDNEY);
    const delta = parseToMinutes(after.dhuhr) - parseToMinutes(before.dhuhr);
    assert.ok(
      delta >= 50 && delta <= 70,
      `expected ~60 min Dhuhr jump, got ${delta} (${before.dhuhr} → ${after.dhuhr})`
    );
  });

  it("falls back displayed Dhuhr by about one hour when Sydney DST ends", () => {
    const before = timesFor(midnightApr4Aedt, SYDNEY);
    const after = timesFor(midnightApr5Aedt, SYDNEY);
    const delta = parseToMinutes(after.dhuhr) - parseToMinutes(before.dhuhr);
    assert.ok(
      delta <= -50 && delta >= -70,
      `expected ~-60 min Dhuhr jump, got ${delta} (${before.dhuhr} → ${after.dhuhr})`
    );
  });

  it("does not apply a one-hour jump in Brisbane on Sydney DST start", () => {
    const before = timesFor(midnightOct3Aest, BRISBANE);
    const after = timesFor(midnightOct4Aest, BRISBANE);
    const delta = parseToMinutes(after.dhuhr) - parseToMinutes(before.dhuhr);
    assert.ok(
      Math.abs(delta) <= 5,
      `Brisbane should not jump an hour, got ${delta} (${before.dhuhr} → ${after.dhuhr})`
    );
  });

  it("recomputes offset Iqama from the DST-shifted Adhan time", () => {
    const after = timesFor(midnightOct4Aest, SYDNEY);
    const updates = recomputeOffsetIqamas(
      { dhuhr_iqama_type: "offset", dhuhr_iqama_offset: 10 },
      {
        fajr: after.fajr,
        dhuhr: after.dhuhr,
        asr: after.asr,
        maghrib: after.maghrib,
        isha: after.isha,
      }
    );
    assert.equal(updates.dhuhr_iqama, addMinutesToTime(after.dhuhr, 10));
  });
});
