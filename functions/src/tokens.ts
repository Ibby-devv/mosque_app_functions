import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {logger} from "firebase-functions";

// ============================================================================
// Type Definitions
// ============================================================================

interface RegisterFcmTokenRequest {
  deviceId: string;
  fcmToken: string;
  platform: "android" | "ios";
  appVersion: string;
  notificationsEnabled: boolean;
}

interface SetNotificationPreferenceRequest {
  deviceId: string;
  enabled: boolean;
  appVersion?: string; // optional lightweight version sync
}

interface GetNotificationPreferenceRequest {
  deviceId: string;
}

interface TouchLastSeenRequest {
  deviceId: string;
  appVersion?: string; // optional version bump on heartbeat
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validates deviceId format: 1-128 chars, alphanumeric plus ._-
 */
function validateDeviceId(deviceId: unknown): string {
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    throw new HttpsError("invalid-argument", "deviceId is required");
  }
  
  if (deviceId.length > 128) {
    throw new HttpsError("invalid-argument", "deviceId too long (max 128)");
  }
  
  if (!/^[a-zA-Z0-9._-]+$/.test(deviceId)) {
    throw new HttpsError(
      "invalid-argument", 
      "deviceId must contain only alphanumeric characters, dots, underscores, or hyphens"
    );
  }
  
  return deviceId;
}

/**
 * Validates FCM token: non-empty string with reasonable length
 */
function validateFcmToken(fcmToken: unknown): string {
  if (typeof fcmToken !== "string" || fcmToken.length === 0) {
    throw new HttpsError("invalid-argument", "fcmToken is required");
  }
  
  if (fcmToken.length > 4096) {
    throw new HttpsError("invalid-argument", "fcmToken too long");
  }
  
  return fcmToken;
}

/**
 * Validates platform enum
 */
function validatePlatform(platform: unknown): "android" | "ios" {
  if (platform !== "android" && platform !== "ios") {
    throw new HttpsError(
      "invalid-argument", 
      "platform must be 'android' or 'ios'"
    );
  }
  return platform;
}

/**
 * Validates app version string
 */
function validateAppVersion(appVersion: unknown): string {
  if (typeof appVersion !== "string" || appVersion.length === 0) {
    throw new HttpsError("invalid-argument", "appVersion is required");
  }
  
  if (appVersion.length > 64) {
    throw new HttpsError("invalid-argument", "appVersion too long");
  }
  
  return appVersion;
}

/**
 * Validates boolean value
 */
function validateBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", `${fieldName} must be a boolean`);
  }
  return value;
}

// ============================================================================
// Rate Limiting Helper (simple per-device check)
// ============================================================================

const recentCalls = new Map<string, number[]>();

/**
 * Simple rate limiter: max 10 calls per minute per device
 */
function checkRateLimit(deviceId: string): void {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  
  const calls = recentCalls.get(deviceId) || [];
  const recentCallsInWindow = calls.filter((timestamp) => now - timestamp < windowMs);
  
  if (recentCallsInWindow.length >= 10) {
    throw new HttpsError(
      "resource-exhausted",
      "Rate limit exceeded. Please try again later."
    );
  }
  
  recentCallsInWindow.push(now);
  recentCalls.set(deviceId, recentCallsInWindow);
}

// ============================================================================
// Callable Functions
// ============================================================================

/**
 * Register or update FCM token for a device.
 * Idempotent: same inputs produce same result.
 * 
 * TODO: Set enforceAppCheck to true after App Check is registered in Firebase Console
 */
export const registerFcmToken = onCall(
  {
    enforceAppCheck: false, // TODO: Change to true after testing
    region: "australia-southeast1",
  },
  async (request: CallableRequest<RegisterFcmTokenRequest>) => {
    const {deviceId, fcmToken, platform, appVersion, notificationsEnabled} = 
      request.data;

    try {
      // Validate inputs
      const validDeviceId = validateDeviceId(deviceId);
      const validFcmToken = validateFcmToken(fcmToken);
      const validPlatform = validatePlatform(platform);
      const validAppVersion = validateAppVersion(appVersion);
      const validEnabled = validateBoolean(notificationsEnabled, "notificationsEnabled");

      // Rate limiting
      checkRateLimit(validDeviceId);

      // Upsert token document
      const tokenRef = admin.firestore().collection("fcmTokens").doc(validDeviceId);
      const existingDoc = await tokenRef.get();
      
      const now = admin.firestore.FieldValue.serverTimestamp();
      const data: any = {
        fcmToken: validFcmToken,
        platform: validPlatform,
        appVersion: validAppVersion,
        notificationsEnabled: validEnabled,
        lastSeen: now,
        updatedAt: now,
      };

      // Set createdAt only on first create
      if (!existingDoc.exists) {
        data.createdAt = now;
      }

      await tokenRef.set(data, {merge: true});

      logger.info("FCM token registered", {
        deviceId: validDeviceId,
        platform: validPlatform,
        appVersion: validAppVersion,
        notificationsEnabled: validEnabled,
        isUpdate: existingDoc.exists,
      });

      return {
        ok: true,
        updated: existingDoc.exists,
      };
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      
      logger.error("Error registering FCM token", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw new HttpsError("internal", "Failed to register token");
    }
  }
);

/**
 * Set notification preference for a device.
 * 
 * TODO: Set enforceAppCheck to true after App Check is registered in Firebase Console
 */
export const setNotificationPreference = onCall(
  {
    enforceAppCheck: false, // TODO: Change to true after testing
    region: "australia-southeast1",
  },
  async (request: CallableRequest<SetNotificationPreferenceRequest>) => {
  const {deviceId, enabled, appVersion} = request.data;

    try {
      const validDeviceId = validateDeviceId(deviceId);
      const validEnabled = validateBoolean(enabled, "enabled");
      const validAppVersion = typeof appVersion === "string" && appVersion.length > 0
        ? validateAppVersion(appVersion)
        : null;

      const tokenRef = admin.firestore().collection("fcmTokens").doc(validDeviceId);

      const updateData: Record<string, any> = {
        notificationsEnabled: validEnabled,
        lastSeen: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (validAppVersion) {
        updateData.appVersion = validAppVersion;
      }

      await tokenRef.update(updateData);

      logger.info("Notification preference updated", {
        deviceId: validDeviceId,
        enabled: validEnabled,
        appVersion: validAppVersion || undefined,
      });

      return {ok: true};
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      
      logger.error("Error setting notification preference", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw new HttpsError("internal", "Failed to update preference");
    }
  }
);

/**
 * Get notification preference for a device.
 * 
 * TODO: Set enforceAppCheck to true after App Check is registered in Firebase Console
 */
export const getNotificationPreference = onCall(
  {
    enforceAppCheck: false, // TODO: Change to true after testing
    region: "australia-southeast1",
  },
  async (request: CallableRequest<GetNotificationPreferenceRequest>) => {
  const {deviceId} = request.data;

    try {
      const validDeviceId = validateDeviceId(deviceId);

      const tokenRef = admin.firestore().collection("fcmTokens").doc(validDeviceId);
      const doc = await tokenRef.get();

      if (!doc.exists) {
        return {
          ok: true,
          exists: false,
          notificationsEnabled: null,
        };
      }

      const data = doc.data();
      
      return {
        ok: true,
        exists: true,
        notificationsEnabled: data?.notificationsEnabled ?? false,
      };
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      
      logger.error("Error getting notification preference", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw new HttpsError("internal", "Failed to get preference");
    }
  }
);

/**
 * Touch lastSeen timestamp for a device (called on app foreground).
 * 
 * TODO: Set enforceAppCheck to true after App Check is registered in Firebase Console
 */
export const touchLastSeen = onCall(
  {
    enforceAppCheck: false, // TODO: Change to true after testing
    region: "australia-southeast1",
  },
  async (request: CallableRequest<TouchLastSeenRequest>) => {
    const {deviceId, appVersion} = request.data;

    try {
      const validDeviceId = validateDeviceId(deviceId);
      const validAppVersion = typeof appVersion === "string" && appVersion.length > 0
        ? validateAppVersion(appVersion)
        : null;

      const tokenRef = admin.firestore().collection("fcmTokens").doc(validDeviceId);
      const doc = await tokenRef.get();

      if (doc.exists) {
        const updateData: Record<string, any> = {
          lastSeen: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (validAppVersion) {
          const currentVersion = doc.data()?.appVersion;
            // Only write if different to minimize writes
          if (currentVersion !== validAppVersion) {
            updateData.appVersion = validAppVersion;
          }
        }
        await tokenRef.update(updateData);
      }

      return {ok: true};
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      
      logger.error("Error touching lastSeen", {
        deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      throw new HttpsError("internal", "Failed to update lastSeen");
    }
  }
);
