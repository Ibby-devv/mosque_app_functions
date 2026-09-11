# Scheduled Iqama Changes - Deployment Guide

## Overview

This feature allows admins to schedule iqama time changes for future dates. Each change is applied the day before the effective date, **30 minutes after the later of today's Iqama and the new Iqama**. That keeps countdown consumers from restarting while still updating the board so people who arrive later in the day see tomorrow's time. Push notifications are sent when the write lands (`onIqamahChanged`).

## Changes Made

### Cloud Functions (`mosque_app_functions`)

#### 1. New File: `functions/src/scheduledIqamaChanges.ts`
Contains:
- **`createScheduledIqamaChange`** - Callable function to create a scheduled change
- **`deleteScheduledIqamaChange`** - Callable function to delete a scheduled change
- **`getScheduledIqamaChanges`** - Callable function to retrieve scheduled changes
- **`processScheduledIqamaChanges`** - Scheduled function (runs every 15 minutes) that:
  - Checks for unapplied changes whose effective date is tomorrow, today, or in the past
  - For tomorrow: applies after `max(today's Iqama, new Iqama) + 30 minutes`
  - For today/past (missed run): applies immediately as catch-up
  - Updates `prayerTimes/current` (triggers existing `onIqamahChanged` notification)

#### 2. Updated Files
- **`functions/src/index.ts`** - Added exports for new functions
- **`firestore.rules`** - Added security rules for `scheduledIqamaChanges` collection
- **`firestore.indexes.json`** - Added composite indexes for efficient queries:
  - `applied` + `effectiveDate` (for scheduler queries)
  - `prayer` + `applied` + `effectiveDate` (for per-prayer queries)

### Admin Dashboard (`mosque-admin-dashboard`)

#### 1. Updated Files
- **`src/types/index.ts`** - Added `ScheduledIqamaChange` interface
- **`src/components/PrayerTimesTab.tsx`** - Major UI additions:
  - "Schedule for Future Date" button on each prayer card
  - Date picker for selecting effective date
  - Display of pending scheduled changes
  - Delete scheduled change functionality
  - Explanation text showing when change will apply

## How It Works

### Scheduling Flow

1. **Admin selects date** (e.g., December 20)
2. **Current iqama settings** (type and value) are saved to `scheduledIqamaChanges` collection
3. **Document stored** with:
   - `effectiveDate`: December 20 at 00:00:00
   - `prayer`: e.g., 'fajr'
   - `iqama_time`: Fixed time string (e.g. "5:45 AM")
   - `applied`: false

### Application Flow

1. **Scheduler runs** every 15 minutes (`*/15 * * * *`, Australia/Sydney)
2. **Loads** unapplied changes with `effectiveDate` through the end of tomorrow (mosque timezone; month/year rollover uses calendar date math, not `day + 1`)
3. **Reads** `prayerTimes/current` for today's Iqama strings
4. **For each pending change**:
   - If effective date is **tomorrow**: apply when mosque time >= `max(today's Iqama, new Iqama) + 30 minutes`
   - If effective date is **today or earlier**: apply immediately (catch-up)
5. **When applied**:
   - Updates `prayerTimes/current` with the new fixed Iqama time
   - Marks schedule as `applied: true` and sets `appliedAt`
6. **Existing `onIqamahChanged` trigger** sends the push notification

### Apply buffer (30 minutes)

`prayerTimes/current` is a single live timetable. After today's occurrence of a prayer, that slot is what visitors treat as **tomorrow's** time. Countdown clients also use that same field as "next Iqama".

Those two consumers conflict if you write too early or too late:

| When you apply | Countdown | Board later in the day |
|---|---|---|
| At today's Iqama (e.g. Isha 7:15 → 7:30 at 7:15) | Restarts to the new time | Correct for tomorrow |
| At midnight on the effective date | Safe | Wrong all previous day (people see old Fajr) |
| **30 min after `max(old, new)` Iqama** | Both times have passed, so "next" cannot jump back | Rest of the day shows tomorrow's time |

**Rule:** `applyAfter = min(max(todayIqama, newIqama) + 30, 23:45)`

- Isha 7:15 → 7:30: wait until **8:00 PM** (7:30 + 30)
- Isha 7:30 → 7:15: wait until **8:00 PM** (today's 7:30 + 30, not the earlier new time)
- Fajr 5:30 → 5:45: wait until **6:15 AM**, so Dhuhr/Asr/Isha visitors see 5:45 for tomorrow
- Very late Iqama + 30 minutes past midnight: cap at **23:45** so the last 15-minute tick of the day still writes on D-1

The 30-minute constant is `IQAMA_CHANGE_APPLY_BUFFER_MINUTES` in `functions/src/utils/iqamaSchedule.ts`.

### Example Timeline

**Scenario:** Admin schedules Fajr Iqama 5:30 AM → 5:45 AM for December 20

- **December 17, 3:00 PM** — Admin creates schedule
- **December 19, 5:30 AM** — Today's Fajr Iqama; scheduler **does not** write yet (countdown still on Fajr; 5:45 is still in the future)
- **December 19, 5:45 AM** — New Fajr clock has also passed; still waiting for the 30-minute buffer
- **December 19, 6:15 AM** — First scheduler run at/after 6:15 applies 5:45 AM to `prayerTimes/current`
- **December 19, 6:15 AM** — Mobile users receive notification
- **December 19, rest of day** — Board/app show 5:45 AM Fajr (tomorrow)
- **December 20** — New Fajr Iqama is in effect

**Scenario:** Isha 7:15 PM → 7:30 PM for December 20

- **December 19, 7:15 PM** — Do not apply (countdown would restart to 7:30)
- **December 19, 7:30 PM** — Do not apply (new time is "now")
- **December 19, 8:00 PM** — Apply; Isha has finished; people leaving the mosque see 7:30 for tomorrow

## Deployment Steps

### Step 1: Deploy Cloud Functions

```bash
cd mosque_app_functions

# Build TypeScript
cd functions
npm run build

# Deploy all functions
cd ..
firebase deploy --only functions

# OR deploy specific functions only (faster)
firebase deploy --only functions:createScheduledIqamaChange,functions:deleteScheduledIqamaChange,functions:getScheduledIqamaChanges,functions:processScheduledIqamaChanges
```

**Expected Output:**
- ✅ 3 new callable functions deployed
- ✅ 1 new scheduled function deployed (runs every 15 minutes)

### Step 2: Deploy Firestore Rules and Indexes

```bash
cd mosque_app_functions

# Deploy security rules
firebase deploy --only firestore:rules

# Deploy indexes (may take 5-10 minutes to build)
firebase deploy --only firestore:indexes
```

**Monitor index creation:**
```bash
firebase firestore:indexes
```

Wait until all indexes show `State: READY` before testing.

### Step 3: Deploy Admin Dashboard

```bash
cd mosque-admin-dashboard

# Build production bundle
npm run build

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

### Step 4: Test the Feature

#### Test 1: Create Scheduled Change
1. Open admin dashboard
2. Navigate to Prayer Times tab
3. Select any prayer (e.g., Fajr)
4. Click "Schedule for Future Date"
5. Select tomorrow's date
6. Click "Schedule"
7. Verify success message appears
8. Verify scheduled change box appears below prayer card

#### Test 2: View in Firestore
```bash
# Open Firebase Console
# Navigate to Firestore Database
# Check scheduledIqamaChanges collection
# Verify document exists with:
#   - prayer: 'fajr'
#   - effectiveDate: Tomorrow at 00:00:00
#   - applied: false
```

#### Test 3: Delete Scheduled Change
1. In admin dashboard, click X button on scheduled change
2. Confirm deletion
3. Verify scheduled change disappears
4. Verify document deleted from Firestore

#### Test 4: Wait for Application (Manual)
This requires waiting for the actual date/time:
1. Create a schedule for tomorrow
2. Wait until **30 minutes after the later of today's Iqama and the new Iqama**
3. Within ~15 minutes after that (scheduler interval), check:
   - Firestore: schedule marked `applied: true`
   - Firestore: `prayerTimes/current` updated with new value
   - Mobile app: Notification received
   - Countdown clients: the prayer that just finished must not restart

#### Test 5: Permissions
1. Log in as user WITHOUT `EDIT_PRAYER_TIMES` permission
2. Verify "Schedule for Future Date" button does not appear
3. Attempt to call function directly (should fail with permission error)

## Validation Checklist

Before marking deployment complete:

- [ ] All cloud functions deployed successfully
- [ ] Firestore indexes created and show `State: READY`
- [ ] Admin dashboard deployed and accessible
- [ ] Can create scheduled change in UI
- [ ] Scheduled change appears in Firestore with correct structure
- [ ] Can delete scheduled change from UI
- [ ] Permission checks working (non-prayer managers can't schedule)
- [ ] Scheduler function appears in Firebase Console with 10-minute schedule
- [ ] No errors in Cloud Functions logs

## Monitoring

### Check Scheduler Logs
```bash
firebase functions:log --only processScheduledIqamaChanges
```

Expected log messages:
- Every 15 minutes: "🕌 Processing scheduled iqama changes..."
- If no schedules: "No scheduled iqama changes to process through tomorrow"
- If pending but not ready: "⏳ Not yet" with the computed apply-after time
- When applied: "✅ Successfully applied scheduled iqama changes"

### Check Function Invocations
Firebase Console → Functions → Dashboard
- Verify `processScheduledIqamaChanges` runs every 15 minutes
- Check for errors in any of the 4 new functions

### Check Firestore
- Collection: `scheduledIqamaChanges`
- Verify documents have correct structure
- Check `applied` field changes from `false` to `true` after application

## Rollback Plan

If issues occur, rollback is simple:

### Rollback Cloud Functions
```bash
# Get previous deployment ID
firebase functions:list

# Rollback to previous version
firebase rollback --only functions
```

### Rollback Admin Dashboard
```bash
# Re-deploy previous version
cd mosque-admin-dashboard
git checkout <previous-commit>
npm run build
firebase deploy --only hosting
```

### Data Cleanup (if needed)
```javascript
// Delete all scheduled changes
const schedulesRef = db.collection('scheduledIqamaChanges');
const snapshot = await schedulesRef.get();
const batch = db.batch();
snapshot.docs.forEach(doc => batch.delete(doc.ref));
await batch.commit();
```

## Known Limitations

1. **Scheduling granularity**: Changes apply at `max(old, new) Iqama + 30 minutes`, then within the next 15-minute scheduler tick
2. **One schedule per prayer per day**: Cannot schedule multiple changes for same prayer on same date
3. **No edit capability**: Must delete and recreate to change scheduled date/value
4. **No bulk scheduling**: Each prayer must be scheduled individually
5. **Requires prayer times to exist**: Scheduler reads current day's Iqama times
6. **Late-night cap**: If Iqama + 30 minutes would cross midnight, the write is capped at 23:45 so it still lands on the day before

## Future Enhancements

Possible improvements for future versions:

1. **Edit scheduled changes** instead of delete/recreate
2. **Bulk scheduling** UI (schedule all prayers for a date at once)
3. **Recurring schedules** (e.g., "every Sunday change Fajr iqama")
4. **Preview notification** before scheduling
5. **Email notification** to admins when change is applied
6. **Schedule history** view showing past applied changes
7. **More flexible timing** (apply at specific time instead of prayer time)

## Support

If you encounter issues:

1. Check Cloud Functions logs for errors
2. Verify Firestore indexes are built
3. Confirm user has `EDIT_PRAYER_TIMES` permission
4. Check browser console for frontend errors
5. Verify Firebase project region is `australia-southeast1`

## Technical Notes

### Why Apply the Day Before, After a Buffer?

`prayerTimes/current` is shared by countdown UIs and the mosque timetable:

- **Do not apply at Iqama time.** If Isha moves from 7:15 to 7:30 at 7:15, the countdown starts again.
- **Do not apply at midnight on the effective date.** Everyone who visits during the previous day (Dhuhr, Asr, Isha) would still see yesterday's Fajr as "tomorrow".
- **Apply 30 minutes after both today's Iqama and the new Iqama have passed.** Countdown for that prayer is finished, and the rest of the day shows tomorrow's time.

Month/year boundaries (31 Jan → 1 Feb, 31 Dec → 1 Jan) use `addCalendarDays` so the scheduler can still find tomorrow's documents. A catch-up path applies any leftover unapplied change on the effective date itself.

### Scheduler Frequency Trade-off

**15-minute interval:**
- More frequent (every 5 min): Higher costs, little benefit on top of the 30-minute buffer
- Less frequent (every 30 min): Can delay the board update by an hour after Iqama
- 15 minutes: Aligns with the buffer without writing during the prayer itself

### Data Structure Design

**Why store a fixed `iqama_time`:**
- Scheduled writes always set `*_iqama` and `*_iqama_type: 'fixed'`
- Daily Adhan recalculation does not overwrite fixed Iqama times

**Why effectiveDate is date-only (midnight):**
- Admins pick a calendar date ("change on Dec 20")
- The scheduler classifies that date as tomorrow vs today/past in the mosque timezone
- Duplicate schedules for the same prayer/day are still rejected on create

## Change Log

- **2026-09-11**: Apply buffer and month-end rollover fix
  - Apply each prayer `30 minutes` after `max(today's Iqama, new Iqama)` (not at Iqama time)
  - Calendar date math for tomorrow so 1st-of-month schedules are found on the 31st
  - Catch-up apply if a change is still unapplied on/after the effective date
  - Shared helpers in `functions/src/utils/iqamaSchedule.ts`
- **2025-12-15**: Initial implementation of scheduled iqama changes
  - Created 4 cloud functions (3 callable, 1 scheduled)
  - Added UI to admin dashboard Prayer Times tab
  - Added Firestore rules and indexes
  - Integrated with existing notification system
