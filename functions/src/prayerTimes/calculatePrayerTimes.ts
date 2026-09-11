import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { Coordinates, CalculationMethod, PrayerTimes as AdhanPrayerTimes } from "adhan";

interface MosqueSettings {
  latitude: number;
  longitude: number;
  calculation_method?: string;
  timezone?: string;
}

const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

/**
 * Add minutes to a 12-hour time string (e.g. "5:41 PM" + 10 → "5:51 PM")
 */
export function addMinutesToTime(
  adhanTime: string,
  offsetMinutes: number
): string | null {
  const timeMatch = adhanTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!timeMatch) {
    return null;
  }

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const period = timeMatch[3].toUpperCase();

  if (period === "PM" && hours !== 12) {
    hours += 12;
  } else if (period === "AM" && hours === 12) {
    hours = 0;
  }

  const dayMinutes = 24 * 60;
  let totalMinutes = hours * 60 + minutes + offsetMinutes;
  totalMinutes = ((totalMinutes % dayMinutes) + dayMinutes) % dayMinutes;

  let newHours = Math.floor(totalMinutes / 60);
  const newMinutes = totalMinutes % 60;

  const newPeriod = newHours >= 12 ? "PM" : "AM";
  if (newHours > 12) {
    newHours -= 12;
  } else if (newHours === 0) {
    newHours = 12;
  }

  return `${newHours}:${newMinutes.toString().padStart(2, "0")} ${newPeriod}`;
}

/**
 * For prayers with iqama_type === 'offset', recompute *_iqama from Adhan + offset.
 */
export function recomputeOffsetIqamas(
  currentData: Record<string, any>,
  adhanTimes: Record<(typeof PRAYERS)[number], string>
): Record<string, string> {
  const updates: Record<string, string> = {};

  for (const prayer of PRAYERS) {
    const iqamaType = currentData[`${prayer}_iqama_type`];
    if (iqamaType !== "offset") {
      continue;
    }

    const offsetRaw = currentData[`${prayer}_iqama_offset`];
    const offset =
      typeof offsetRaw === "number"
        ? offsetRaw
        : typeof offsetRaw === "string"
          ? parseInt(offsetRaw, 10)
          : NaN;

    if (!Number.isFinite(offset)) {
      logger.warn(`⚠️ Offset Iqama for ${prayer} missing valid offset; skipping recompute`);
      continue;
    }

    const adhanTime = adhanTimes[prayer];
    const iqamaTime = addMinutesToTime(adhanTime, offset);
    if (!iqamaTime) {
      logger.warn(`⚠️ Could not compute offset Iqama for ${prayer} from adhan "${adhanTime}"`);
      continue;
    }

    updates[`${prayer}_iqama`] = iqamaTime;
  }

  return updates;
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

    // Calculate prayer times for today IN THE MOSQUE'S TIMEZONE
    // Get mosque timezone and create a date for today in that timezone
    const mosqueTimezone = mosqueSettings.timezone || "Australia/Sydney";

    // Get today's date in the mosque's timezone
    const now = new Date();
    const dateString = now.toLocaleDateString("en-US", { timeZone: mosqueTimezone });
    const date = new Date(dateString); // This creates a Date at midnight in the mosque's timezone

    const adhanPrayerTimes = new AdhanPrayerTimes(coordinates, date, params);

    // Convert Date objects to 12-hour format strings in mosque timezone
    const formatTime = (date: Date): string => {
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: mosqueTimezone,
      });
    };

    const adhanTimes = {
      fajr: formatTime(adhanPrayerTimes.fajr),
      shuruq: formatTime(adhanPrayerTimes.sunrise),
      dhuhr: formatTime(adhanPrayerTimes.dhuhr),
      asr: formatTime(adhanPrayerTimes.asr),
      maghrib: formatTime(adhanPrayerTimes.maghrib),
      isha: formatTime(adhanPrayerTimes.isha),
    };

    // Get current server timestamp
    const sydneyTimestamp = admin.firestore.Timestamp.now();

    // Get prayer times document reference
    const prayerTimesRef = admin
      .firestore()
      .collection("prayerTimes")
      .doc("current");

    const currentDoc = await prayerTimesRef.get();

    if (!currentDoc.exists) {
      throw new Error("Prayer times document does not exist");
    }

    const currentData = currentDoc.data() || {};
    const offsetIqamaUpdates = recomputeOffsetIqamas(currentData, adhanTimes);

    // Update Adhan times (incl. Shuruq/sunrise) and recompute any offset-based Iqama times
    await prayerTimesRef.update({
      fajr_adhan: adhanTimes.fajr,
      shuruq_adhan: adhanTimes.shuruq,
      dhuhr_adhan: adhanTimes.dhuhr,
      asr_adhan: adhanTimes.asr,
      maghrib_adhan: adhanTimes.maghrib,
      isha_adhan: adhanTimes.isha,
      ...offsetIqamaUpdates,
      last_updated: sydneyTimestamp,
    });

    logger.info("✅ Prayer times calculated and updated successfully", {
      method: methodName,
      ...adhanTimes,
      offsetIqamasUpdated: Object.keys(offsetIqamaUpdates),
      lastUpdated: sydneyTimestamp.toDate().toISOString(),
    });
  } catch (error) {
    logger.error("❌ Error calculating prayer times", error);
    throw error;
  }
}
