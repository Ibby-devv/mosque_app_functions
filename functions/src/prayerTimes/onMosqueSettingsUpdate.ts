import { logger } from "firebase-functions";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { calculateAndUpdatePrayerTimes } from "./calculatePrayerTimes";

interface MosqueSettings {
  latitude?: number;
  longitude?: number;
  calculation_method?: string;
}

/**
 * Trigger prayer time recalculation when mosque settings change
 * Watches for changes to calculation_method, latitude, or longitude
 */
export const onMosqueSettingsUpdate = onDocumentUpdated(
  {
    document: "mosqueSettings/info",
    region: "australia-southeast1",
  },
  async (event) => {
    try {
      const before = event.data?.before.data() as MosqueSettings | undefined;
      const after = event.data?.after.data() as MosqueSettings | undefined;

      if (!after) {
        logger.warn("⚠️ Mosque settings document deleted");
        return;
      }

      // Check if relevant settings changed
      const methodChanged = before?.calculation_method !== after.calculation_method;
      const latitudeChanged = before?.latitude !== after.latitude;
      const longitudeChanged = before?.longitude !== after.longitude;

      if (methodChanged || latitudeChanged || longitudeChanged) {
        logger.info("🔄 Mosque settings changed - recalculating prayer times", {
          methodChanged,
          latitudeChanged,
          longitudeChanged,
          oldMethod: before?.calculation_method,
          newMethod: after.calculation_method,
        });

        // Validate that we have the required settings
        if (!after.latitude || !after.longitude) {
          logger.error("❌ Cannot calculate prayer times - missing latitude or longitude");
          return;
        }

        // Trigger prayer time recalculation
        await calculateAndUpdatePrayerTimes({
          latitude: after.latitude,
          longitude: after.longitude,
          calculation_method: after.calculation_method,
        });

        logger.info("✅ Prayer times recalculated due to settings change");
      } else {
        logger.info("ℹ️ Mosque settings updated but prayer time calculation not affected");
      }
    } catch (error) {
      logger.error("❌ Error in onMosqueSettingsUpdate", error);
      // Don't throw - allow the settings update to succeed even if prayer time calculation fails
    }
  }
);
