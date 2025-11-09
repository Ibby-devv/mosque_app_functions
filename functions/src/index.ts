import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";

// Set global region for all functions
setGlobalOptions({ region: "australia-southeast1" });

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
export { onNotificationLogCreated } from "./cleanup/onNotificationLogCreated";
export { onNotificationLogUpdated } from "./cleanup/onNotificationLogUpdated";
export { onEventCreated as onEventCreatedImageCleanup } from "./cleanup/onEventCreated";
export { onEventUpdated as onEventUpdatedImageCleanup } from "./cleanup/onEventUpdated";
export { onCampaignCreated as onCampaignCreatedImageCleanup } from "./cleanup/onCampaignCreated";
export { onCampaignUpdated as onCampaignUpdatedImageCleanup } from "./cleanup/onCampaignUpdated";
export { cleanupStaleTokens } from "./cleanup/cleanupStaleTokens";
export { cleanupTmpImages } from "./cleanup/cleanupTmpImages";
export { geocodeAddress } from './geocoding';
export { 
  setUserRole, 
  listAdmins, 
  removeAdmin,
  createUserAccount,
  setUserRoles,
  listUsers,
  removeUserRoles
} from './adminManagement';
export { setSuperAdminProtection } from './setSuperAdmin';
export { updateUserProfile } from './updateUserProfile';
export { deleteUser } from './deleteUser';
export { 
  registerFcmToken, 
  setNotificationPreference, 
  getNotificationPreference, 
  touchLastSeen 
} from './tokens';
export { onMosqueSettingsUpdate } from './prayerTimes/onMosqueSettingsUpdate';
export { updatePrayerTimes } from './prayerTimes/updatePrayerTimes';
