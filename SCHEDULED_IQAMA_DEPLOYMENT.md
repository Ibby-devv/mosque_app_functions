# Scheduled Iqama Changes - Deployment Guide

## Overview

This feature allows admins to schedule iqama time changes for future dates. When the scheduled date arrives, the change is applied automatically at the prayer's time on the day before, and push notifications are sent to mobile users.

## Changes Made

### Cloud Functions (`mosque_app_functions`)

#### 1. New File: `functions/src/scheduledIqamaChanges.ts`
Contains:
- **`createScheduledIqamaChange`** - Callable function to create a scheduled change
- **`deleteScheduledIqamaChange`** - Callable function to delete a scheduled change
- **`getScheduledIqamaChanges`** - Callable function to retrieve scheduled changes
- **`processScheduledIqamaChanges`** - Scheduled function (runs every 10 minutes) that:
  - Checks for changes scheduled for tomorrow
  - Compares current time against each prayer's adhan time
  - Applies changes once prayer time has passed
  - Updates `prayerTimes/current` document (triggers existing `onIqamahChanged` notification)

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
   - `iqama_type`: 'fixed' or 'offset'
   - `iqama_value`: Time string or offset minutes
   - `applied`: false

### Application Flow

1. **Scheduler runs** every 10 minutes
2. **Checks** if current date = tomorrow's date for any scheduled change
3. **If match found**, reads current prayer times to get today's adhan times
4. **For each pending change**, checks if current time >= prayer's adhan time
5. **When condition met**:
   - Updates `prayerTimes/current` with new iqama settings
   - Marks schedule as `applied: true`
   - Sets `appliedAt` timestamp
6. **Existing `onIqamahChanged` trigger** automatically sends push notification

### Example Timeline

**Scenario:** Admin schedules Fajr iqama change for December 20

- **December 17, 3:00 PM** - Admin creates schedule
- **December 19, 5:30 AM** - Fajr adhan time occurs
- **December 19, 5:35 AM** - Scheduler runs, detects:
  - Current date (Dec 19) = effectiveDate (Dec 20) - 1 day ✓
  - Current time (5:35 AM) >= Fajr adhan (5:30 AM) ✓
- **December 19, 5:35 AM** - Change applied to Firestore
- **December 19, 5:35 AM** - Mobile users receive notification
- **December 20** - New iqama time is in effect

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
- ✅ 1 new scheduled function deployed (runs every 10 minutes)

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
2. Wait until tomorrow's prayer time
3. Within ~10 minutes after prayer time, check:
   - Firestore: schedule marked `applied: true`
   - Firestore: `prayerTimes/current` updated with new value
   - Mobile app: Notification received

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
- Every 10 minutes: "🕌 Processing scheduled iqama changes..."
- If no schedules: "No scheduled iqama changes to process for tomorrow"
- If pending but not ready: "No scheduled changes ready to apply yet (waiting for prayer times)"
- When applied: "✅ Successfully applied scheduled iqama changes"

### Check Function Invocations
Firebase Console → Functions → Dashboard
- Verify `processScheduledIqamaChanges` runs every 10 minutes
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

1. **Scheduling granularity**: Changes apply at prayer time ±10 minutes (scheduler interval)
2. **One schedule per prayer per day**: Cannot schedule multiple changes for same prayer on same date
3. **No edit capability**: Must delete and recreate to change scheduled date/value
4. **No bulk scheduling**: Each prayer must be scheduled individually
5. **Requires prayer times to exist**: Scheduler reads current day's adhan times

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

### Why Apply at Prayer Time the Day Before?

**User Experience Consideration:**
- Applying at midnight would wake users with notification
- Applying on the scheduled day means users might miss notification before prayer
- Applying at previous day's prayer time means:
  - ✅ Users are awake/at mosque
  - ✅ Timely advance notice (24 hours)
  - ✅ Contextual timing (during relevant prayer)

### Scheduler Frequency Trade-off

**10-minute interval chosen for balance:**
- More frequent (every 5 min): Higher costs, minimal benefit
- Less frequent (every 30 min): Delayed notifications, poor UX
- 10 minutes: Good balance of cost and timeliness

### Data Structure Design

**Why store iqama_type and iqama_value separately:**
- Preserves admin's chosen approach (fixed vs offset)
- Allows recalculation of offset-based times
- Maintains consistency with existing `prayerTimes` schema

**Why effectiveDate is date-only (midnight):**
- Simplifies queries (exact match on date)
- Prevents duplicate schedules for same prayer/day
- Easier for admins to understand ("change on Dec 20")

## Change Log

- **2025-12-15**: Initial implementation of scheduled iqama changes
  - Created 4 cloud functions (3 callable, 1 scheduled)
  - Added UI to admin dashboard Prayer Times tab
  - Added Firestore rules and indexes
  - Integrated with existing notification system
