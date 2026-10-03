import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { timestampToStringSync } from "./messagingHelpers";
import { zonedDateTimeToUtcMillis } from "./iqamaSchedule";

describe("timestampToStringSync", () => {
  const tz = "Australia/Sydney";

  it("renders 4 October 2026 14:30 as DD-MM-YYYY HH:mm", () => {
    const instant = new Date(zonedDateTimeToUtcMillis(2026, 10, 4, 14, 30, tz));
    assert.equal(timestampToStringSync(instant, tz), "04-10-2026 14:30");
  });

  it("does not emit hour 24 at local midnight", () => {
    const midnight = new Date("2026-09-11T14:00:00.000Z"); // 12 Sep 00:00 AEST
    assert.equal(timestampToStringSync(midnight, tz), "12-09-2026 00:00");
  });
});
