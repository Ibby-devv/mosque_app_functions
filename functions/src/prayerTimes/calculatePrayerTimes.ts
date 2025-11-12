import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { Coordinates, CalculationMethod, PrayerTimes as AdhanPrayerTimes } from "adhan";
import { getSydneyDate } from "../utils/dateHelpers";

interface MosqueSettings {
  latitude: number;
  longitude: number;
  calculation_method?: string;
}

/**
 * Calculate and update prayer times in Firestore using the adhan package
 * This function is shared between the daily scheduled update and the settings change trigger
 */
export async function calculateAndUpdatePrayerTimes(
  mosqueSettings: MosqueSettings
): Promise<void> {
  logger.info("🕌 Calculating prayer times...", {
    latitude: mosqueSettings.latitude,
    longitude: mosqueSettings.longitude,
    method: mosqueSettings.calculation_method,
  });

  try {
    // Validate mosque settings
    if (!mosqueSettings.latitude || !mosqueSettings.longitude) {
      throw new Error("Mosque location (latitude/longitude) not configured");
    }

    // Set up coordinates
    const coordinates = new Coordinates(
      mosqueSettings.latitude,
      mosqueSettings.longitude
    );

    // Get calculation method (default to MuslimWorldLeague if not specified)
    const methodName = mosqueSettings.calculation_method || "MuslimWorldLeague";
    const params = CalculationMethod[methodName as keyof typeof CalculationMethod]();

    // Calculate prayer times for today
    const date = new Date();
    const adhanPrayerTimes = new AdhanPrayerTimes(coordinates, date, params);

    // Convert Date objects to 12-hour format strings in Sydney timezone
    const formatTime = (date: Date): string => {
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "Australia/Sydney",
      });
    };

    // Get current date in Sydney timezone (YYYY-MM-DD format)
    const sydneyDate = getSydneyDate();

    // Get prayer times document reference
    const prayerTimesRef = admin
      .firestore()
      .collection("prayerTimes")
      .doc("current");

    const currentDoc = await prayerTimesRef.get();

    if (!currentDoc.exists) {
      throw new Error("Prayer times document does not exist");
    }

    // Update only Adhan times, preserve all Iqama settings
    await prayerTimesRef.update({
      fajr_adhan: formatTime(adhanPrayerTimes.fajr),
      dhuhr_adhan: formatTime(adhanPrayerTimes.dhuhr),
      asr_adhan: formatTime(adhanPrayerTimes.asr),
      maghrib_adhan: formatTime(adhanPrayerTimes.maghrib),
      isha_adhan: formatTime(adhanPrayerTimes.isha),
      last_updated: sydneyDate,
    });

    logger.info("✅ Prayer times calculated and updated successfully", {
      method: methodName,
      fajr: formatTime(adhanPrayerTimes.fajr),
      dhuhr: formatTime(adhanPrayerTimes.dhuhr),
      asr: formatTime(adhanPrayerTimes.asr),
      maghrib: formatTime(adhanPrayerTimes.maghrib),
      isha: formatTime(adhanPrayerTimes.isha),
      date: sydneyDate,
    });
  } catch (error) {
    logger.error("❌ Error calculating prayer times", error);
    throw error;
  }
}
