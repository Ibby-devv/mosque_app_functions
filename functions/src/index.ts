import {onSchedule} from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

admin.initializeApp();

export {
  createPaymentIntent,
  createSubscription,
  cancelSubscription,
  getDonationSettings} from "./donations";

export { handleStripeWebhook } from "./webhooks";
export * from "./subscriptionManagement";
export * from "./getDonations";
export { getDonationAnalytics } from "./getDonationAnalytics";
export { onEventCreated } from "./notifications/onEventCreated";
export { onEventUpdated } from "./notifications/onEventUpdated";
export { onCampaignCreated } from "./notifications/onCampaignCreated";
export { onIqamahChanged } from "./notifications/onIqamahChanged";
export { sendCustomNotification } from "./notifications/sendCustomNotification";
export { onEventDeleted } from "./cleanup/onEventDeleted";
export { onCampaignDeleted } from "./cleanup/onCampaignDeleted";
export { onNotificationLogDeleted } from "./cleanup/onNotificationLogDeleted";
export { cleanupStaleTokens } from "./cleanup/cleanupStaleTokens";
export { geocodeAddress } from './geocoding';
export { 
  setUserRole, 
  listAdmins, 
  removeAdmin,
  createUserAccount
} from './adminManagement';
export { setSuperAdminProtection } from './setSuperAdmin';
export { 
  registerFcmToken, 
  setNotificationPreference, 
  getNotificationPreference, 
  touchLastSeen 
} from './tokens';

// Runs every day at midnight Sydney time
export const updatePrayerTimes = onSchedule(
  {
    schedule: "0 0 * * *",
    timeZone: "Australia/Sydney",
    region: "australia-southeast1",
  },
  async () => {
    try {
      console.log("🕌 Auto-updating prayer times...");

      // Get mosque settings from Firestore
      const settingsDoc = await admin
        .firestore()
        .collection("mosqueSettings")
        .doc("info")
        .get();

      console.log("🔍 Settings doc exists:", settingsDoc.exists);

      const settings = settingsDoc.data();

      console.log("🔍 Settings data:", JSON.stringify(settings, null, 2));

      if (!settings?.latitude || !settings?.longitude) {
        console.error("❌ No mosque location configured");
        console.error("Settings object:", settings);
        return;
      }

      // Fetch from Aladhan API
      const timestamp = Math.floor(Date.now() / 1000);
      const method = settings.calculation_method || 3;

      const apiUrl = `https://api.aladhan.com/v1/timings/${timestamp}?latitude=${settings.latitude}&longitude=${settings.longitude}&method=${method}`;

      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data.code !== 200 || !data.data?.timings) {
        throw new Error("Invalid API response from Aladhan");
      }

      // Convert 24-hour to 12-hour format
      const convertTo12Hour = (time24: string): string => {
        const [hours24, minutes] = time24.split(":");
        let hours = parseInt(hours24);
        const period = hours >= 12 ? "PM" : "AM";

        if (hours > 12) {
          hours -= 12;
        } else if (hours === 0) {
          hours = 12;
        }

        return `${hours}:${minutes} ${period}`;
      };

      const timings = data.data.timings;

      // Get current prayer times to preserve Iqama settings
      const prayerTimesRef = admin
        .firestore()
        .collection("prayerTimes")
        .doc("current");

      const currentDoc = await prayerTimesRef.get();

      if (!currentDoc.exists) {
        console.error("❌ Prayer times document does not exist");
        return;
      }

      // Update only Adhan times, keep all Iqama settings
      const sydneyDate = new Date()
        .toLocaleString("en-AU", {
          timeZone: "Australia/Sydney",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
        .split("/")
        .reverse()
        .join("-"); // Convert DD/MM/YYYY to YYYY-MM-DD

      await prayerTimesRef.update({
        fajr_adhan: convertTo12Hour(timings.Fajr),
        dhuhr_adhan: convertTo12Hour(timings.Dhuhr),
        asr_adhan: convertTo12Hour(timings.Asr),
        maghrib_adhan: convertTo12Hour(timings.Maghrib),
        isha_adhan: convertTo12Hour(timings.Isha),
        last_updated: sydneyDate,
      });

      console.log("✅ Prayer times updated successfully:", {
        fajr: convertTo12Hour(timings.Fajr),
        dhuhr: convertTo12Hour(timings.Dhuhr),
        asr: convertTo12Hour(timings.Asr),
        maghrib: convertTo12Hour(timings.Maghrib),
        isha: convertTo12Hour(timings.Isha),
      });
    } catch (error) {
      console.error("❌ Error updating prayer times:", error);
    }
  }
);
