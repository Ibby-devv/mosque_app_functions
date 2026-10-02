# Time system plan (functions, dashboard, mobile app)

Handoff for an agent that has all three repositories in one workspace. Implement this plan. Do not invent a fourth way to store dates.

Repositories:

- `mosque_app_functions` (this repo) — Cloud Functions, Firestore indexes
- `mosque-admin-dashboard` — admin writer for events, prayer times, and schedules
- `al-ansar-masjid-app` — mobile reader (countdown, events, donations)

Scheduled Iqama civil dates are already implemented on branch `cursor/fix-dst-iqama-apply-3929` in this repo (not necessarily merged). Start from that branch if it is not on `main`. Do not replace it with another midnight-timestamp scheme.

## Contract

Every value is one of three kinds. Pick the kind before writing code.

| Kind | Meaning | Store as | Example |
|---|---|---|---|
| Civil date | A calendar day. No clock, no offset. | `YYYY-MM-DD` string | Iqama effective day, donation `date`, event day |
| Civil time | A clock time on that day. No timezone. | `HH:mm` 24-hour string | Adhan, Iqama, event start |
| Instant | A real moment on the timeline. | Firestore `Timestamp` | `createdAt`, `appliedAt`, `lastSeen`, payment completion |

Rules:

- The only timezone is `mosqueSettings/info.timezone`, an IANA name such as `Australia/Sydney`. If it is missing, use `Australia/Sydney`.
- "Today" means the civil date of `now` in that timezone, from `Intl.DateTimeFormat` with `hourCycle: "h23"`. Never from `new Date(localeString)` and never from `Date#getFullYear()` on a UTC instant.
- Compare civil dates as `YYYY-MM-DD` strings or as `{year, month, day}`. A daylight-saving day is 23 or 25 hours, so do not divide timestamp differences by `24 * 60 * 60 * 1000` to count days.
- Display an instant with `Intl` and the mosque timezone. Do not call `setHours` on an instant to mean "mosque local time."
- `5:45 AM` is a display format. Storage for new writes is `HH:mm`. Readers must accept both until old documents are gone.
- Do not encode a civil date as local midnight or UTC midnight. That encoding is what shifted Sunday 4 Oct 2026 to Saturday 23:00 and made the Fajr schedule apply during Saturday's prayer.

Forbidden patterns:

- `new Date(date.toLocaleString(...))`
- `new Date(now.toLocaleDateString(...))`
- `Date.UTC(y, m, d, hour, minute)` where `hour` and `minute` are a mosque clock time
- `timestamp.toDate().getFullYear()` / `getDate()` to recover a civil day (that uses the machine zone)
- `hour12: false` without also handling hour `24`. Prefer `hourCycle: "h23"`.

## Shared helpers

Copy one module into each repo and keep the tests the same. Names already exist in `functions/src/utils/iqamaSchedule.ts`. Reuse them. Do not rewrite the offset math.

```ts
formatCivilDate(date) -> "YYYY-MM-DD"
parseCivilDate(value) -> {year, month, day} | null   // reject 2026-02-31
zonedParts(instant, timeZone) -> {year, month, day, hour, minute}  // hourCycle h23
formatClock(minutes) -> "HH:mm"
parseClock(value) -> minutes | null   // accept "HH:mm" and "h:mm AM/PM"
formatClockDisplay(minutes) -> "h:mm AM"  // UI only
civilDateFromMidnightInstant(instant, timeZone) -> civil date
```

`civilDateFromMidnightInstant` is only for documents already stored as a midnight timestamp. It returns the civil date whose true local midnight is closest to that instant. A correct midnight matches exactly. The old October DST bug stored Sunday as Saturday 23:00; that still resolves to Sunday. Do not use this for new writes.

`mosqueMidnightMillis` may stay as a compatibility output for old clients that display `new Date(millis)`. It is not a storage format.

## Already done in functions

On `cursor/fix-dst-iqama-apply-3929`:

- `createScheduledIqamaChange` stores `effectiveDate` as the `YYYY-MM-DD` the admin sent.
- The scheduler compares that civil date with today's mosque civil date. Tomorrow waits until 30 minutes after `max(today's Iqama, new Iqama)`. Today or earlier still catch-up applies.
- Legacy Timestamp `effectiveDate` values are decoded with `resolveEffectiveCivilDate`.
- `getScheduledIqamaChanges` returns `effectiveDay` (`YYYY-MM-DD`) and `effectiveDate` (millis of that day's real local midnight) so the current dashboard keeps rendering.

Do not undo this. The dashboard should switch to `effectiveDay` and then the millis field can be removed.

## Rollout order

Installed phone apps keep running old code. Changing a field from Timestamp to string in place breaks their Firestore queries.

1. Functions: finish the remaining bugs below. Deploy reads that understand both shapes.
2. Dashboard: write the new fields and keep writing the old fields for one release.
3. Mobile app: read the new fields when present, fall back to the legacy decode. Ship this before any backfill.
4. Backfill script: fill the new fields on old documents. Keep the old fields.
5. After that app version is what people are running, stop writing the old fields. Do not do step 5 in the same change as step 3.

Iqama clock strings (`"5:45 AM"`) are already what the app countdown parses. You may add `HH:mm` later. Do not change stored Iqama strings in the same release as the event-date migration. A strict parser that accepts only a full clock token is enough for now.

## Functions (`mosque_app_functions`)

### Adhan calculation

`functions/src/prayerTimes/calculatePrayerTimes.ts` builds the adhan-js date with:

```ts
const date = new Date(now.toLocaleDateString("en-US", { timeZone: mosqueTimezone }));
```

The comment says this is midnight in the mosque timezone. It is not. On the UTC Cloud Functions runtime the calendar day happens to be right. Replace it: take `zonedParts(now, mosqueTimezone)` and construct the date adhan-js needs from those year, month, and day components (noon UTC, or noon in the process zone, so `getFullYear/getMonth/getDate` stay on that civil day). Format the resulting instants with `timeZone: mosqueTimezone`.

The dashboard has the same block in `src/components/PrayerTimesTab.tsx` around the "Refresh" calculation. Fix both.

### Event "already past" check

`functions/src/notifications/onEventUpdated.ts` does this:

```ts
const nowInMosqueTimezone = new Date(new Date().toLocaleString("en-US", { timeZone: mosqueTimezone }));
eventDate.setHours(adjustedHours, minutes, 0, 0);
if (eventDate < nowInMosqueTimezone) skip;
```

That parses a mosque clock string as UTC and then sets UTC hours on the stored instant. A 2:30 PM Sydney event is treated as past at 10:00 AM Sydney on that day, so the update notification is dropped.

After events have `event_date` and `event_time`, compare those with `zonedParts(now)`. Until then, decode the legacy timestamp with `civilDateFromMidnightInstant` for the day, and parse `event.time` as the clock. Do not `setHours` on the Firestore timestamp.

### Notification weekday

`functions/src/notifications/onEventCreated.ts` formats the weekday with hardcoded `Australia/Sydney` while `timestampToString` uses the mosque timezone. Use the mosque timezone for both. Once `event_date` exists, format that civil date in the mosque zone instead of formatting the raw timestamp.

### Email instants

These format in the server zone (UTC on Cloud Functions), so a Sydney afternoon can print as the previous day:

- `functions/src/webhooks.ts` — `invoice.next_payment_attempt`, subscription `created_at`, dispute `evidence_details.due_by` via `toLocaleDateString("en-AU")` with no `timeZone`

Format them with the mosque timezone. These are instants, not civil dates. Donation `date` is already a correct `YYYY-MM-DD` from `getMosqueDateString()`. Leave that storage alone.

### Receipt year and daily job

`functions/src/donations.ts` `generateReceiptNumber` hardcodes `Australia/Sydney`. `functions/src/prayerTimes/updatePrayerTimes.ts` is scheduled at `0 0 * * *` in `Australia/Sydney`.

Cloud Scheduler's timezone is fixed at deploy time. Keep the cron entry on `Australia/Sydney` only while that is the configured mosque zone. Inside the function, compute "today" from `mosqueSettings.timezone` before calculating prayer times. Receipt numbers should use that same civil year.

`*/15 * * * *` on the Iqama scheduler does not depend on the cron timezone. Leave the cadence. The decision inside already uses the mosque zone.

### `timestampToString`

`functions/src/utils/messagingHelpers.ts` uses `hour12: false`. Switch to `hourCycle: "h23"` and map hour `24` to `00`.

## Dashboard (`mosque-admin-dashboard`)

### Events

`src/components/EventsTab.tsx` currently:

- Saves `date` as `Date.UTC(year, month - 1, day)` (UTC midnight).
- Saves `start_date` as `Date.UTC(year, month - 1, day, hour, minute)` (the mosque clock written as if it were UTC).
- Loads the edit form with `date.getFullYear()` / `getDate()` (the admin laptop's zone).
- `isPastEvent` compares a Sydney "today" string with `getFullYear()` of the timestamp.

Write, on every save:

- `event_date`: `YYYY-MM-DD` from the date input
- `event_time`: `HH:mm` from the time input
- Keep writing `date`, `start_date`, and `time` for the installed app until the app release below is current. When you keep writing them, still write UTC midnight for `date` so old Sydney clients do not move the day. Do not invent a new timestamp encoding.

`isPastEvent` and the edit form should use `event_date` when it is a `YYYY-MM-DD` string, and only then fall back to `civilDateFromMidnightInstant`.

There is an existing test file `src/components/EventsTab.test.tsx` that locks in the local-component approach. Update it to the civil-date contract.

### Scheduled Iqama

`src/types/index.ts` says `effectiveDate: number`. `PrayerTimesTab.tsx` displays `new Date(scheduledChange.effectiveDate).toLocaleDateString('en-AU')`.

Display `effectiveDay` from `getScheduledIqamaChanges`. The create call already sends `YYYY-MM-DD`. No timestamp conversion on the way in.

### Prayer time refresh

`PrayerTimesTab.tsx` duplicates the functions adhan date bug (`new Date(toLocaleDateString(...))`). Use the same civil-date construction as the functions fix.

### Donation range picker

`src/components/DonationAnalyticsTab.tsx` `getDateRange` does `new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }))`. Build today's `YYYY-MM-DD` with `Intl` in the mosque timezone, then do calendar arithmetic on that date. The analytics API already filters on civil `date` strings.

## Mobile app (`al-ansar-masjid-app`)

### Countdown

`app/(tabs)/index.tsx` `getSydneyNowParts` is the right model (mosque wall clock versus Iqama minutes). Change the formatter to `hourCycle: "h23"` and treat hour `24` as `0`. Rename is optional. Keep parsing `"h:mm AM"` Iqama strings.

### Events query

`hooks/useEvents.ts` queries:

```ts
.where('date', '>=', todayTimestamp) // device-local midnight
.orderBy('date', 'asc')
.orderBy('time', 'asc')
```

`todayTimestamp` is the phone's local midnight, compared with a UTC-midnight `date`. That drops or shifts events around midnight and depends on the phone zone.

New query, once `event_date` is populated:

```ts
.where('is_active', '==', true)
.where('event_date', '>=', todayCivilDate) // "YYYY-MM-DD" in the mosque zone
.orderBy('event_date', 'asc')
.orderBy('event_time', 'asc')
```

Add that composite index in `mosque_app_functions/firestore.indexes.json` and deploy indexes before shipping the app query. Firestore will reject the listener until the index exists.

Until the backfill has run, the app cannot switch the query, because a range query does not mix Timestamp and string in one field. Sequence:

- App release A: if a document has `event_date`, use it for display and for the today/tomorrow badge. Keep the existing `date >= timestamp` query so old documents still load.
- Backfill: write `event_date` / `event_time` on every event.
- App release B: switch the query to `event_date`. Remove the timestamp query.

### Event display

`app/(tabs)/events.tsx` formats the Timestamp in the mosque zone, then rebuilds a local `Date` and divides by 24 hours for the today/tomorrow badge. On a 23-hour or 25-hour civil day that badge is wrong.

When `event_date` exists, show that date and `event_time` (formatted to 12-hour for display). Compare `event_date` with today's mosque civil date for the badge. Do not format `start_date` as the clock the user sees. The `time` / `event_time` string is the clock the admin entered.

### Donations

`app/(tabs)/donate/history.tsx` formats instants with the mosque timezone. Leave that. It is the correct way to show an instant.

## Backfill

One script, run after dashboard writes and app release A are deployed:

- For each `events` document missing `event_date`: set `event_date` from `civilDateFromMidnightInstant(date, mosqueTimezone)`, and `event_time` from the existing `time` string normalized to `HH:mm`.
- Do not delete `date`, `start_date`, or `time`.
- Scheduled Iqama documents that still have a Timestamp `effectiveDate` can be rewritten to `YYYY-MM-DD` using `resolveEffectiveCivilDate`. The scheduler already reads both, so this backfill is optional.
- Donation `date` strings are already civil dates. Do not convert them to timestamps.

## Tests the agent must add

Functions (`npm test` in `functions/`):

- Adhan input date's calendar day is the mosque civil day on 4 Oct 2026 (DST starts) and 5 Apr 2026 (DST ends), for `Australia/Sydney`.
- An event at 14:30 mosque time is not "past" at 10:00 mosque time the same civil day.
- `timestampToString` at local midnight does not emit hour 24.

Dashboard:

- Saving an event persists `event_date: "2026-10-04"` and `event_time: "14:30"`.
- Reopening that event shows 4 Oct 2026, including when the test runner's zone is UTC.
- `isPastEvent` uses the civil date, not `getDate()` on a Timestamp.

App:

- Today/tomorrow badge compares `YYYY-MM-DD` strings. A date on the spring-forward Sunday is still "tomorrow" when today is the day before.
- Countdown at 00:30 mosque time does not treat the hour as 24.

## Out of scope

- Changing the 30-minute Iqama apply buffer.
- Moving Iqama storage from `"5:45 AM"` to `HH:mm` in this same pass.
- Rewriting Stripe instants (`created_at`, `completed_at`) into civil dates. Only their display timezone is wrong.
- A shared npm package. Copy the helper and its tests into each repo. A package can come later if the copies start to diverge.
