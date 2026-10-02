import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { Coordinates, CalculationMethod, PrayerTimes as AdhanPrayerTimes } from "adhan";
import { getZonedDateTimeParts } from "../utils/iqamaSchedule";

interface MosqueSettings {
  latitude: number;
  longitude: number;
  calculation_method?: string;
  timezone?: string;
}

export const DEFAULT_MOSQUE_TIMEZONE = "Australia/Sydney";

export type AdhanTimes = {
  fajr: string;
  shuruq: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
};

/**
 * Calendar date in the mosque timezone, as a Date whose local Y/M/D adhan-js will read.
 *
 * adhan-js uses getFullYear/getMonth/getDate (process-local) then emits UTC Date
 * instants. Cloud Functions run in UTC; noon local keeps those parts on the mosque
 * calendar day and avoids DST missing-hour issues around 2–3 AM.
 */
export function dateForAdhanCalculation(now: Date, mosqueTimezone: string): Date {
  const parts = getZonedDateTimeParts(now, mosqueTimezone);
  return new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
}

/**
 * Format an adhan UTC instant as 12-hour clock time in the mosque IANA timezone.
 * IANA zones such as Australia/Sydney include Australian daylight saving.
 */
export function formatPrayerTime(date: Date, mosqueTimezone: string): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: mosqueTimezone,
  });
}

export function computeAdhanTimes(
  latitude: number,
  longitude: number,
  methodName: string,
  now: Date,
  mosqueTimezone: string
): AdhanTimes {
  const coordinates = new Coordinates(latitude, longitude);
  const methodFactory =
    CalculationMethod[methodName as keyof typeof CalculationMethod];
  if (typeof methodFactory !== "function") {
    throw new Error(`Unknown calculation method: ${methodName}`);
  }
  const params = methodFactory();
  const date = dateForAdhanCalculation(now, mosqueTimezone);
  const adhanPrayerTimes = new AdhanPrayerTimes(coordinates, date, params);

  return {
    fajr: formatPrayerTime(adhanPrayerTimes.fajr, mosqueTimezone),
    shuruq: formatPrayerTime(adhanPrayerTimes.sunrise, mosqueTimezone),
    dhuhr: formatPrayerTime(adhanPrayerTimes.dhuhr, mosqueTimezone),
    asr: formatPrayerTime(adhanPrayerTimes.asr, mosqueTimezone),
    maghrib: formatPrayerTime(adhanPrayerTimes.maghrib, mosqueTimezone),
    isha: formatPrayerTime(adhanPrayerTimes.isha, mosqueTimezone),
  };
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
    timezone: mosqueSettings.timezone || DEFAULT_MOSQUE_TIMEZONE,
  });

  try {
    // Validate mosque settings
    if (!mosqueSettings.latitude || !mosqueSettings.longitude) {
      throw new Error("Mosque location (latitude/longitude) not configured");
    }

    const methodName = mosqueSettings.calculation_method || "MuslimWorldLeague";
    const mosqueTimezone = mosqueSettings.timezone || DEFAULT_MOSQUE_TIMEZONE;
    const now = new Date();
    const adhanTimes = computeAdhanTimes(
      mosqueSettings.latitude,
      mosqueSettings.longitude,
      methodName,
      now,
      mosqueTimezone
    );

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
      timezone: mosqueTimezone,
      ...adhanTimes,
      offsetIqamasUpdated: Object.keys(offsetIqamaUpdates),
      lastUpdated: sydneyTimestamp.toDate().toISOString(),
    });
  } catch (error) {
    logger.error("❌ Error calculating prayer times", error);
    throw error;
  }
}
