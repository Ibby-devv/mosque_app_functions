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

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ScheduledIqamaChange {
  id: string;
  prayer: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
  effectiveDate: admin.firestore.Timestamp; // Date when change should be applied (midnight)
  iqama_type: 'fixed' | 'offset';
  iqama_value: string | number; // Time string for fixed, number for offset
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

  const { prayer, effectiveDate, iqama_type, iqama_value } = request.data;

  // Validate input
  if (!prayer || !['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].includes(prayer)) {
    throw new HttpsError("invalid-argument", "Invalid prayer name");
  }

  if (!effectiveDate) {
    throw new HttpsError("invalid-argument", "Effective date is required");
  }

  if (!iqama_type || !['fixed', 'offset'].includes(iqama_type)) {
    throw new HttpsError("invalid-argument", "Invalid iqama type");
  }

  if (iqama_value === undefined || iqama_value === null) {
    throw new HttpsError("invalid-argument", "Iqama value is required");
  }

  try {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    
    // Convert effectiveDate to Timestamp (set to midnight in mosque timezone)
    const effectiveDateTimestamp = admin.firestore.Timestamp.fromMillis(effectiveDate);
    
    // Validate that effectiveDate is in the future
    if (effectiveDateTimestamp.toMillis() <= now.toMillis()) {
      throw new HttpsError(
        "invalid-argument", 
        "Effective date must be in the future (at least tomorrow)"
      );
    }

    // Check if a scheduled change already exists for this prayer on this date
    // Compare only the date part (year-month-day)
    const effectiveDateObj = effectiveDateTimestamp.toDate();
    effectiveDateObj.setHours(0, 0, 0, 0);
    const startOfDay = admin.firestore.Timestamp.fromDate(effectiveDateObj);
    
    const endOfDayObj = new Date(effectiveDateObj);
    endOfDayObj.setHours(23, 59, 59, 999);
    const endOfDay = admin.firestore.Timestamp.fromDate(endOfDayObj);

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
      iqama_type,
      iqama_value,
      applied: false,
      createdBy: request.auth.uid,
      createdAt: now,
    };

    const docRef = await db.collection("scheduledIqamaChanges").add(scheduleData);

    logger.info("✅ Scheduled iqama change created", {
      id: docRef.id,
      prayer,
      effectiveDate: effectiveDateTimestamp.toDate().toISOString(),
      createdBy: request.auth.uid,
    });

    return { 
      success: true, 
      id: docRef.id,
      message: `Scheduled ${prayer} iqama change for ${effectiveDateTimestamp.toDate().toLocaleDateString()}`
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
    const schedules: ScheduledIqamaChange[] = [];

    snapshot.forEach((doc) => {
      schedules.push({
        id: doc.id,
        ...doc.data(),
      } as ScheduledIqamaChange);
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
// Runs every 10 minutes to check for changes that should be applied
// ============================================================================

export const processScheduledIqamaChanges = onSchedule({
  schedule: "*/10 * * * *", // Every 10 minutes
  timeZone: "Australia/Sydney",
  region: "australia-southeast1",
}, async () => {
  try {
    logger.info("🕌 Processing scheduled iqama changes...");

    const db = admin.firestore();
    const now = new Date();
    
    // Get current time in Sydney timezone
    const sydneyTime = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Sydney" }));
    
    // Calculate yesterday's date (since we apply changes 1 day before effective date)
    const tomorrow = new Date(sydneyTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const tomorrowTimestamp = admin.firestore.Timestamp.fromDate(tomorrow);

    // Get all unapplied scheduled changes for tomorrow
    const pendingChanges = await db
      .collection("scheduledIqamaChanges")
      .where("applied", "==", false)
      .where("effectiveDate", "==", tomorrowTimestamp)
      .get();

    if (pendingChanges.empty) {
      logger.info("No scheduled iqama changes to process for tomorrow");
      return;
    }

    logger.info(`Found ${pendingChanges.size} scheduled changes for tomorrow`);

    // Get current prayer times to check adhan times
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

    // Process each scheduled change
    const changesToApply: ScheduledIqamaChange[] = [];
    
    for (const doc of pendingChanges.docs) {
      const schedule = { id: doc.id, ...doc.data() } as ScheduledIqamaChange;
      const adhanTimeStr = currentPrayerTimes[`${schedule.prayer}_adhan`];
      
      if (!adhanTimeStr) {
        logger.warn(`⚠️ No adhan time found for ${schedule.prayer}`);
        continue;
      }

      // Parse adhan time (e.g., "5:30 AM")
      const adhanTime = parseTime(adhanTimeStr);
      if (!adhanTime) {
        logger.warn(`⚠️ Could not parse adhan time: ${adhanTimeStr}`);
        continue;
      }

      const currentTimeMinutes = sydneyTime.getHours() * 60 + sydneyTime.getMinutes();

      // Check if current time is past this prayer's adhan time today
      if (currentTimeMinutes >= adhanTime) {
        changesToApply.push(schedule);
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
      // Update prayer times
      if (schedule.iqama_type === 'fixed') {
        updates[`${schedule.prayer}_iqama`] = schedule.iqama_value;
        updates[`${schedule.prayer}_iqama_type`] = 'fixed';
      } else {
        updates[`${schedule.prayer}_iqama_offset`] = schedule.iqama_value;
        updates[`${schedule.prayer}_iqama_type`] = 'offset';
        
        // Calculate and set the actual iqama time based on offset
        const adhanTimeStr = currentPrayerTimes[`${schedule.prayer}_adhan`];
        const calculatedIqama = calculateIqamaFromOffset(adhanTimeStr, schedule.iqama_value as number);
        if (calculatedIqama) {
          updates[`${schedule.prayer}_iqama`] = calculatedIqama;
        }
      }

      // Mark schedule as applied
      const scheduleRef = db.collection("scheduledIqamaChanges").doc(schedule.id);
      batch.update(scheduleRef, {
        applied: true,
        appliedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`✅ Applied scheduled change for ${schedule.prayer}`, {
        id: schedule.id,
        effectiveDate: schedule.effectiveDate.toDate().toISOString(),
        iqama_type: schedule.iqama_type,
        iqama_value: schedule.iqama_value,
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse time string (e.g., "5:30 AM") to minutes since midnight
 */
function parseTime(timeStr: string): number | null {
  try {
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return null;

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();

    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }

    return hours * 60 + minutes;
  } catch (error) {
    return null;
  }
}

/**
 * Calculate iqama time from adhan time + offset minutes
 */
function calculateIqamaFromOffset(adhanTime: string, offset: number): string | null {
  try {
    const match = adhanTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return null;

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();

    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }

    let totalMinutes = hours * 60 + minutes + offset;
    let newHours = Math.floor(totalMinutes / 60) % 24;
    const newMinutes = totalMinutes % 60;

    const newPeriod = newHours >= 12 ? 'PM' : 'AM';
    if (newHours > 12) {
      newHours -= 12;
    } else if (newHours === 0) {
      newHours = 12;
    }

    return `${newHours}:${newMinutes.toString().padStart(2, '0')} ${newPeriod}`;
  } catch (error) {
    return null;
  }
}
