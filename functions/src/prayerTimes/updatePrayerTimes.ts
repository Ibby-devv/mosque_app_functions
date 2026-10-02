import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { calculateAndUpdatePrayerTimes } from "./calculatePrayerTimes";

/**
 * Scheduled function that runs daily at midnight Sydney time
 * Automatically updates prayer times for the current day
 */
export const updatePrayerTimes = onSchedule(
  {
    schedule: "0 0 * * *",
    // IANA zone so Cloud Scheduler follows AEDT/AEST (not a fixed UTC+10 offset)
    timeZone: "Australia/Sydney",
    region: "australia-southeast1",
  },
  async () => {
    try {
      logger.info("🕌 Daily prayer times update triggered");

      // Get mosque settings from Firestore
      const settingsDoc = await admin
        .firestore()
        .collection("mosqueSettings")
        .doc("info")
        .get();

      if (!settingsDoc.exists) {
        logger.error("❌ Mosque settings document does not exist");
        return;
      }

      const settings = settingsDoc.data();

      if (!settings) {
        logger.error("❌ No mosque settings data found");
        return;
      }

      // Use shared calculation utility
      await calculateAndUpdatePrayerTimes({
        latitude: settings.latitude,
        longitude: settings.longitude,
        calculation_method: settings.calculation_method,
        timezone: settings.timezone,
      });

      logger.info("✅ Daily prayer times update completed");
    } catch (error) {
      logger.error("❌ Error in daily prayer times update", error);
    }
  }
);
