// ============================================================================
// CLOUD FUNCTIONS: Scheduled Iqama Changes Management
// Location: functions/src/scheduledIqamaChanges.ts
// ============================================================================

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { hasPermission } from "./utils/roles";
import { Permission } from "./utils/roles";
import {
  IQAMA_CHANGE_APPLY_BUFFER_MINUTES,
  addCalendarDays,
  getZonedDateTimeParts,
  minutesSinceMidnight,
  mosqueMidnightMillis,
  parseTimeToMinutes,
  classifyEffectiveDate,
  decideScheduledIqamaApply,
  formatMinuteOfDay,
} from "./utils/iqamaSchedule";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ScheduledIqamaChange {
  id: string;
  prayer: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
  effectiveDate: admin.firestore.Timestamp; // Date when change should be applied (midnight)
  iqama_time: string; // Fixed time only (e.g., "6:00 AM")
  applied: boolean;
  createdBy: string; // Admin user ID
  createdAt: admin.firestore.Timestamp;
  appliedAt?: admin.firestore.Timestamp;
}

// ============================================================================
// CALLABLE FUNCTION: Create Scheduled Iqama Change
// ============================================================================

export const createScheduledIqamaChange = onCall({
  region: "australia-southeast1",
  cors: true,
  invoker: "public",
}, async (request) => {
  // Auth check
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  // Permission check - extract permissions from token
  const userPermissions = (request.auth.token.permissions as Permission[]) || [];
  if (!hasPermission(userPermissions, Permission.EDIT_PRAYER_TIMES)) {
    throw new HttpsError(
      "permission-denied",
      "User does not have permission to schedule prayer time changes"
    );
  }

  const { prayer, effectiveDate, iqama_time } = request.data;

  // Validate input
  if (!prayer || !['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].includes(prayer)) {
    throw new HttpsError("invalid-argument", "Invalid prayer name");
  }

  if (!effectiveDate || typeof effectiveDate !== 'string') {
    throw new HttpsError("invalid-argument", "Effective date is required and must be a date string (YYYY-MM-DD)");
  }

  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new HttpsError("invalid-argument", "Effective date must be in format YYYY-MM-DD");
  }

  if (!iqama_time || typeof iqama_time !== 'string') {
    throw new HttpsError("invalid-argument", "Iqama time is required and must be a valid time string");
  }

  // Validate time format (e.g., "6:00 AM")
  if (!/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(iqama_time)) {
    throw new HttpsError("invalid-argument", "Iqama time must be in format '6:00 AM'");
  }

  try {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    
    // Get mosque timezone from settings
    const mosqueSettingsDoc = await db.collection("mosqueSettings").doc("info").get();
    if (!mosqueSettingsDoc.exists) {
      throw new HttpsError("failed-precondition", "Mosque settings not found");
    }
    const mosqueTimezone = mosqueSettingsDoc.data()?.timezone || "Australia/Sydney";
    
    const [year, month, day] = effectiveDate.split('-').map(Number);
    const startOfDay = admin.firestore.Timestamp.fromMillis(
      mosqueMidnightMillis(year, month, day, mosqueTimezone)
    );
    
    // Validate that effectiveDate is in the future
    if (startOfDay.toMillis() <= now.toMillis()) {
      throw new HttpsError(
        "invalid-argument", 
        "Effective date must be in the future (at least tomorrow)"
      );
    }
    
    // Calculate end of day for date comparison
    const endOfDay = admin.firestore.Timestamp.fromMillis(
      startOfDay.toMillis() + (24 * 60 * 60 * 1000 - 1)
    );

    const existingSchedules = await db
      .collection("scheduledIqamaChanges")
      .where("prayer", "==", prayer)
      .where("applied", "==", false)
      .where("effectiveDate", ">=", startOfDay)
      .where("effectiveDate", "<=", endOfDay)
      .get();

    if (!existingSchedules.empty) {
      throw new HttpsError(
        "already-exists",
        `A scheduled change already exists for ${prayer} on this date`
      );
    }

    // Create the scheduled change document
    const scheduleData: Omit<ScheduledIqamaChange, 'id'> = {
      prayer,
      effectiveDate: startOfDay, // Store as start of day for consistent querying
      iqama_time,
      applied: false,
      createdBy: request.auth.uid,
      createdAt: now,
    };

    const docRef = await db.collection("scheduledIqamaChanges").add(scheduleData);

    logger.info("✅ Scheduled iqama change created", {
      id: docRef.id,
      prayer,
      effectiveDate: startOfDay.toDate().toISOString(),
      createdBy: request.auth.uid,
    });

    return { 
      success: true, 
      id: docRef.id,
      message: `Scheduled ${prayer} iqama change for ${effectiveDate}`
    };

  } catch (error: any) {
    logger.error("❌ Error creating scheduled iqama change:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Failed to create scheduled change");
  }
});

// ============================================================================
// CALLABLE FUNCTION: Delete Scheduled Iqama Change
// ============================================================================

export const deleteScheduledIqamaChange = onCall({
  region: "australia-southeast1",
  cors: true,
  invoker: "public",
}, async (request) => {
  // Auth check
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  // Permission check - extract permissions from token
  const userPermissions = (request.auth.token.permissions as Permission[]) || [];
  if (!hasPermission(userPermissions, Permission.EDIT_PRAYER_TIMES)) {
    throw new HttpsError(
      "permission-denied",
      "User does not have permission to manage scheduled prayer time changes"
    );
  }

  const { id } = request.data;

  if (!id) {
    throw new HttpsError("invalid-argument", "Schedule ID is required");
  }

  try {
    const db = admin.firestore();
    const docRef = db.collection("scheduledIqamaChanges").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new HttpsError("not-found", "Scheduled change not found");
    }

    const scheduleData = doc.data() as ScheduledIqamaChange;

    // Prevent deletion of already applied changes
    if (scheduleData.applied) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot delete an already applied scheduled change"
      );
    }

    await docRef.delete();

    logger.info("✅ Scheduled iqama change deleted", {
      id,
      prayer: scheduleData.prayer,
      deletedBy: request.auth.uid,
    });

    return { success: true, message: "Scheduled change deleted successfully" };

  } catch (error: any) {
    logger.error("❌ Error deleting scheduled iqama change:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError("internal", "Failed to delete scheduled change");
  }
});

// ============================================================================
// CALLABLE FUNCTION: Get Scheduled Iqama Changes
// ============================================================================

export const getScheduledIqamaChanges = onCall({
  region: "australia-southeast1",
  cors: true,
  invoker: "public",
}, async (request) => {
  // Auth check
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }

  // Permission check - extract permissions from token
  const userPermissions = (request.auth.token.permissions as Permission[]) || [];
  if (!hasPermission(userPermissions, Permission.EDIT_PRAYER_TIMES)) {
    throw new HttpsError(
      "permission-denied",
      "User does not have permission to view scheduled prayer time changes"
    );
  }

  const { prayer, includeApplied = false } = request.data;

  try {
    const db = admin.firestore();
    let query = db.collection("scheduledIqamaChanges")
      .orderBy("effectiveDate", "asc");

    // Filter by prayer if specified
    if (prayer) {
      query = query.where("prayer", "==", prayer) as any;
    }

    // Filter by applied status
    if (!includeApplied) {
      query = query.where("applied", "==", false) as any;
    }

    const snapshot = await query.get();
    const schedules: any[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      schedules.push({
        id: doc.id,
        prayer: data.prayer,
        effectiveDate: data.effectiveDate.toMillis(), // Convert Timestamp to milliseconds
        iqama_time: data.iqama_time,
        applied: data.applied,
        createdBy: data.createdBy,
        createdAt: data.createdAt.toMillis(),
        appliedAt: data.appliedAt?.toMillis(),
      });
    });

    logger.info("✅ Retrieved scheduled iqama changes", {
      count: schedules.length,
      prayer: prayer || "all",
      requestedBy: request.auth.uid,
    });

    return { success: true, schedules };

  } catch (error: any) {
    logger.error("❌ Error retrieving scheduled iqama changes:", error);
    throw new HttpsError("internal", "Failed to retrieve scheduled changes");
  }
});

// ============================================================================
// SCHEDULED FUNCTION: Process Scheduled Iqama Changes
// Runs every 15 minutes. Applies each prayer after max(today, new) + 30 min.
// ============================================================================

export const processScheduledIqamaChanges = onSchedule({
  schedule: "*/15 * * * *", // Every 15 minutes
  timeZone: "Australia/Sydney", // Default scheduler timezone (can be changed)
  region: "australia-southeast1",
}, async () => {
  try {
    logger.info("🕌 Processing scheduled iqama changes...");

    const db = admin.firestore();
    
    // Get mosque settings to read configured timezone
    const mosqueSettingsDoc = await db
      .collection("mosqueSettings")
      .doc("info")
      .get();

    if (!mosqueSettingsDoc.exists) {
      logger.error("❌ Mosque settings document not found");
      return;
    }

    const mosqueSettings = mosqueSettingsDoc.data();
    if (!mosqueSettings) {
      logger.error("❌ No mosque settings data found");
      return;
    }

    // Use mosque's configured timezone, fallback to Australia/Sydney
    const mosqueTimezone = mosqueSettings.timezone || "Australia/Sydney";
    logger.info(
      `Using mosque timezone: ${mosqueTimezone}; ` +
        `apply buffer ${IQAMA_CHANGE_APPLY_BUFFER_MINUTES} minutes after ` +
        `max(today's Iqama, new Iqama)`
    );

    const mosqueDate = getZonedDateTimeParts(new Date(), mosqueTimezone);
    const today: { year: number; month: number; day: number } = {
      year: mosqueDate.year,
      month: mosqueDate.month,
      day: mosqueDate.day,
    };
    const tomorrow = addCalendarDays(today.year, today.month, today.day, 1);
    const dayAfterTomorrow = addCalendarDays(today.year, today.month, today.day, 2);

    // Query unapplied changes through the end of tomorrow (inclusive of
    // tomorrow midnight). Calendar addDays handles month/year rollover.
    const endOfTomorrowMillis =
      mosqueMidnightMillis(
        dayAfterTomorrow.year,
        dayAfterTomorrow.month,
        dayAfterTomorrow.day,
        mosqueTimezone
      ) - 1;
    const endOfTomorrow = admin.firestore.Timestamp.fromMillis(endOfTomorrowMillis);

    logger.info(
      `Mosque date ${today.year}-${today.month}-${today.day}; ` +
        `tomorrow ${tomorrow.year}-${tomorrow.month}-${tomorrow.day}`
    );

    const pendingChanges = await db
      .collection("scheduledIqamaChanges")
      .where("applied", "==", false)
      .where("effectiveDate", "<=", endOfTomorrow)
      .get();

    if (pendingChanges.empty) {
      logger.info("No scheduled iqama changes to process through tomorrow");
      return;
    }

    logger.info(`Found ${pendingChanges.size} unapplied scheduled change(s) through tomorrow`);

    const prayerTimesDoc = await db
      .collection("prayerTimes")
      .doc("current")
      .get();

    if (!prayerTimesDoc.exists) {
      logger.error("❌ Prayer times document not found");
      return;
    }

    const currentPrayerTimes = prayerTimesDoc.data();
    if (!currentPrayerTimes) {
      logger.error("❌ No prayer times data found");
      return;
    }

    const currentTimeMinutes = minutesSinceMidnight(mosqueDate.hour, mosqueDate.minute);
    const changesToApply: ScheduledIqamaChange[] = [];
    
    for (const doc of pendingChanges.docs) {
      const schedule = { id: doc.id, ...doc.data() } as ScheduledIqamaChange;
      const effectiveParts = getZonedDateTimeParts(
        schedule.effectiveDate.toDate(),
        mosqueTimezone
      );
      const effectiveDateKind = classifyEffectiveDate(effectiveParts, today);

      const todayIqamaStr = currentPrayerTimes[`${schedule.prayer}_iqama`];
      const todayIqamaMinutes = todayIqamaStr
        ? parseTimeToMinutes(todayIqamaStr)
        : null;
      const newIqamaMinutes = parseTimeToMinutes(schedule.iqama_time);

      const decision = decideScheduledIqamaApply({
        currentMinutes: currentTimeMinutes,
        todayIqamaMinutes,
        newIqamaMinutes,
        effectiveDateKind,
      });

      if (decision.action === "apply") {
        logger.info(
          `✅ Ready to apply: ${schedule.prayer} ` +
            `(${todayIqamaStr ?? "?"} → ${schedule.iqama_time}) ` +
            `effective ${effectiveParts.year}-${effectiveParts.month}-${effectiveParts.day}; ` +
            `now ${formatMinuteOfDay(currentTimeMinutes)}; ${decision.reason}`
        );
        changesToApply.push(schedule);
      } else if (decision.action === "wait") {
        logger.info(
          `⏳ Not yet: ${schedule.prayer} ` +
            `(${todayIqamaStr ?? "?"} → ${schedule.iqama_time}); ` +
            `now ${formatMinuteOfDay(currentTimeMinutes)}; ${decision.reason}` +
            (decision.applyAfterMinutes != null
              ? ` (apply after ${formatMinuteOfDay(decision.applyAfterMinutes)})`
              : "")
        );
      } else {
        logger.info(`⏭️ Skip: ${schedule.prayer}; ${decision.reason}`);
      }
    }

    if (changesToApply.length === 0) {
      logger.info("No scheduled changes ready to apply yet (waiting for prayer times)");
      return;
    }

    logger.info(`Applying ${changesToApply.length} scheduled iqama changes`);

    // Apply all changes in a batch
    const batch = db.batch();
    const prayerTimesRef = db.collection("prayerTimes").doc("current");
    const updates: any = {};

    for (const schedule of changesToApply) {
      // Update prayer times with scheduled fixed time
      updates[`${schedule.prayer}_iqama`] = schedule.iqama_time;
      updates[`${schedule.prayer}_iqama_type`] = 'fixed';

      // Mark schedule as applied
      const scheduleRef = db.collection("scheduledIqamaChanges").doc(schedule.id);
      batch.update(scheduleRef, {
        applied: true,
        appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`✅ Applied scheduled change for ${schedule.prayer}`, {
        id: schedule.id,
        effectiveDate: schedule.effectiveDate.toDate().toISOString(),
        iqama_time: schedule.iqama_time,
      });
    }

    // Apply all updates to prayer times
    updates.last_updated = admin.firestore.FieldValue.serverTimestamp();
    batch.update(prayerTimesRef, updates);

    await batch.commit();

    logger.info("✅ Successfully applied scheduled iqama changes", {
      count: changesToApply.length,
      prayers: changesToApply.map(s => s.prayer),
    });

    // Note: The onIqamahChanged trigger will automatically send notifications
    // when the prayerTimes/current document is updated

  } catch (error: any) {
    logger.error("❌ Error processing scheduled iqama changes:", error);
  }
});

