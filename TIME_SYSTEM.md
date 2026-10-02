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
- Display an instant in the mosque timezone. Do not call `setHours` on an instant to mean "mosque local time."
- `5:45 AM` is a display format. Storage for new writes is `HH:mm`. Readers must accept both until old documents are gone.
- This app is for an Australian mosque. Every date a person sees is `DD-MM-YYYY` (4 October 2026 is `04-10-2026`). That includes the admin dashboard, the mobile app, push notifications, and emails.
- Storage and query strings stay `YYYY-MM-DD`. That form sorts and compares correctly. Convert to `DD-MM-YYYY` only at the screen, notification, or email.
- Do not use `toLocaleDateString("en-AU")` or `toLocaleDateString("en-US")` for anything a person reads. `en-AU` uses slashes (`04/10/2026`). `en-US` puts the month first (`10/4/2026`). Format the parts yourself.
- A native `<input type="date">` still speaks `YYYY-MM-DD` in the DOM and paints the browser's own locale in the control. Leave that control alone. Format every other date with the helper below.
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
formatCivilDate(date) -> "YYYY-MM-DD"          // storage, queries, <input type="date">
parseCivilDate(value) -> {year, month, day} | null   // accept YYYY-MM-DD; reject 2026-02-31
formatCivilDateDisplay(date) -> "DD-MM-YYYY"   // every user-visible date
zonedParts(instant, timeZone) -> {year, month, day, hour, minute}  // hourCycle h23
formatClock(minutes) -> "HH:mm"
parseClock(value) -> minutes | null   // accept "HH:mm" and "h:mm AM/PM"
formatClockDisplay(minutes) -> "h:mm AM"  // UI only
formatInstantDisplay(instant, timeZone) -> "DD-MM-YYYY HH:mm"
civilDateFromMidnightInstant(instant, timeZone) -> civil date
```

`formatCivilDateDisplay({ year: 2026, month: 10, day: 4 })` is `04-10-2026`. Pad the day and month. When a time sits next to a date, put the date first: `04-10-2026 14:30`.

`civilDateFromMidnightInstant` is only for documents already stored as a midnight timestamp. It returns the civil date whose true local midnight is closest to that instant. A correct midnight matches exactly. The old October DST bug stored Sunday as Saturday 23:00; that still resolves to Sunday. Do not use this for new writes.

`mosqueMidnightMillis` may stay as a compatibility output for old clients that display `new Date(millis)`. It is not a storage format.

## Already done in functions

On `cursor/fix-dst-iqama-apply-3929`:

- `createScheduledIqamaChange` stores `effectiveDate` as the `YYYY-MM-DD` the admin sent.
- The scheduler compares that civil date with today's mosque civil date. Tomorrow waits until 30 minutes after `max(today's Iqama, new Iqama)`. Today or earlier still catch-up applies.
- Legacy Timestamp `effectiveDate` values are decoded with `resolveEffectiveCivilDate`.
- `getScheduledIqamaChanges` returns `effectiveDay` (`YYYY-MM-DD`) and `effectiveDate` (millis of that day's real local midnight) so the current dashboard keeps rendering.
- Adhan calculation no longer does `new Date(toLocaleDateString(...))`. `dateForAdhanCalculation` takes the mosque civil date from `getZonedDateTimeParts` and builds noon in the process zone so adhan-js reads that year, month, and day. Display still uses `timeZone: mosqueTimezone`. Stored Adhan and Iqama strings stay 12-hour (`5:45 AM`) in this change.

Do not undo this. The dashboard should switch to `effectiveDay` and then the millis field can be removed. The two other Fajr branches (`cursor/fix-iqama-dst-schedule-1585`, `cursor/fix-iqama-dst-midnight-f153`) were earlier attempts at the same scheduler bug, including a noon-snap decode. Do not merge them back.

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

Functions already use `dateForAdhanCalculation` in `functions/src/prayerTimes/calculatePrayerTimes.ts`. Leave that in place.

The dashboard still has the old block in `src/components/PrayerTimesTab.tsx` around the "Refresh" calculation (`new Date(toLocaleDateString(...))`). Use the same civil-date construction: mosque year, month, and day at noon in the process zone, then format the adhan instants with `timeZone` set to the mosque zone.

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

`timestampToString` in `functions/src/utils/messagingHelpers.ts` currently returns `DD/MM/YYYY HH:mm`. Change it to `DD-MM-YYYY HH:mm` via `formatInstantDisplay`. Notification text such as "Sunday, 04/10/2026" should become "Sunday, 04-10-2026". Weekday names can stay in front of the numeric date.

### Email instants

These format in the server zone (UTC on Cloud Functions), so a Sydney afternoon can print as the previous day:

- `functions/src/webhooks.ts` — `invoice.next_payment_attempt`, subscription `created_at`, dispute `evidence_details.due_by` via `toLocaleDateString("en-AU")` with no `timeZone`

Format them in the mosque timezone as `DD-MM-YYYY`. These are instants, not civil dates. Donation `date` is already a correct `YYYY-MM-DD` from `getMosqueDateString()`. Leave that storage alone. Emails that print it must go through `formatCivilDateDisplay`.

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

Display `effectiveDay` from `getScheduledIqamaChanges` as `DD-MM-YYYY` (`04-10-2026`). The create call already sends `YYYY-MM-DD`. No timestamp conversion on the way in. The date picker value stays `YYYY-MM-DD`.

### Prayer time refresh

`PrayerTimesTab.tsx` still builds the adhan date with `new Date(toLocaleDateString(...))`. Use the same `dateForAdhanCalculation` construction as functions.

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

When `event_date` exists, show that date as `DD-MM-YYYY` and `event_time` formatted to 12-hour. A heading may be "Saturday, 04-10-2026". Compare `event_date` with today's mosque civil date for the badge. Do not format `start_date` as the clock the user sees. The `time` / `event_time` string is the clock the admin entered.

### Donations

`app/(tabs)/donate/history.tsx` already formats instants in the mosque timezone. Change the rendered text to `DD-MM-YYYY HH:mm`. The zone is right. The glyph from `en-AU` (`04/10/2026`) is not the format this app uses.

## Display checklist

Search all three repos for `toLocaleDateString`, `toLocaleString`, and hand-built date labels. Each user-visible date becomes `formatCivilDateDisplay` or `formatInstantDisplay`. Known call sites:

- `functions/src/utils/messagingHelpers.ts` `timestampToString`
- `functions/src/webhooks.ts` payment, cancellation, and dispute emails
- `mosque-admin-dashboard` `PrayerTimesTab.tsx` scheduled effective date, `DonationAnalyticsTab.tsx` table dates, `EventsTab.tsx` list dates, `NotificationsTab.tsx`, `AdminManagementTab.tsx`
- `al-ansar-masjid-app` `app/(tabs)/events.tsx`, `app/(tabs)/index.tsx` jumuah or header dates, `app/(tabs)/donate/history.tsx`, `app/(tabs)/donate/give.tsx`

Add a test that 4 October 2026 renders as `04-10-2026` and not `10/04/2026`, `04/10/2026`, or `2026-10-04`.

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
- `timestampToString` at local midnight does not emit hour 24, and 4 October 2026 14:30 renders as `04-10-2026 14:30`.

Dashboard:

- Saving an event persists `event_date: "2026-10-04"` and `event_time: "14:30"`.
- The event list shows `04-10-2026`. Reopening the editor still loads `2026-10-04` into the date input when the test runner's zone is UTC.
- `isPastEvent` uses the civil date, not `getDate()` on a Timestamp.

App:

- Today/tomorrow badge compares `YYYY-MM-DD` strings. A date on the spring-forward Sunday is still "tomorrow" when today is the day before.
- Countdown at 00:30 mosque time does not treat the hour as 24.

## Out of scope

- Changing the 30-minute Iqama apply buffer.
- Moving Iqama storage from `"5:45 AM"` to `HH:mm` in this same pass.
- Rewriting Stripe instants (`created_at`, `completed_at`) into civil dates. Only their display timezone is wrong.
- A shared npm package. Copy the helper and its tests into each repo. A package can come later if the copies start to diverge.
