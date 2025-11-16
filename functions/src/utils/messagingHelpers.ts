// ============================================================================
// UTILITY: FCM Messaging Helpers
// Location: functions/src/utils/messagingHelpers.ts
// ============================================================================

import * as admin from "firebase-admin";

/**
 * Serialize any Timestamp objects in an object to ISO 8601 strings
 * This ensures FCM data payloads only contain string values
 * 
 * @param data Object that may contain Timestamp fields
 * @returns Object with Timestamps converted to ISO strings
 */
export function serializeTimestamps(data: Record<string, any>): Record<string, string> {
  const serialized: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) {
      serialized[key] = "";
    } else if (value instanceof admin.firestore.Timestamp) {
      // Convert Timestamp to ISO 8601 string
      serialized[key] = value.toDate().toISOString();
    } else if (typeof value === "object" && value.toDate && typeof value.toDate === "function") {
      // Handle Timestamp-like objects (duck typing)
      serialized[key] = value.toDate().toISOString();
    } else {
      // Convert everything else to string
      serialized[key] = String(value);
    }
  }
  
  return serialized;
}

/**
 * Build FCM message payload with proper configuration for data-only messages
 * 
 * IMPORTANT: For data-only messages to trigger background handlers on Android/iOS:
 * - Android: Must set priority: 'high'
 * - iOS: Must set content-available: true + proper APNs headers
 * 
 * This ensures background message handlers are invoked when app is backgrounded/quit.
 * 
 * NOTE: Automatically serializes any Timestamp objects to ISO strings
 */
export function buildDataOnlyMessage(data: Record<string, any>, tokens: string[]): admin.messaging.MulticastMessage {
  // Serialize any Timestamp objects to strings
  const serializedData = serializeTimestamps(data);
  
  return {
    data: serializedData,
    tokens,
    // Android configuration
    android: {
      priority: 'high', // CRITICAL: Allows background wake on Android
    },
    // iOS configuration (for future iOS support)
    apns: {
      payload: {
        aps: {
          contentAvailable: true, // CRITICAL: Allows background wake on iOS
        },
      },
      headers: {
        'apns-push-type': 'background',
        'apns-priority': '5', // Low priority for background
      },
    },
  };
}

/**
 * Build FCM message with notification payload (shows system notification)
 * Use this when you want Android/iOS to display the notification automatically
 * 
 * NOTE: Automatically serializes any Timestamp objects to ISO strings
 */
export function buildNotificationMessage(
  title: string,
  body: string,
  data: Record<string, any>,
  tokens: string[]
): admin.messaging.MulticastMessage {
  // Serialize any Timestamp objects to strings
  const serializedData = serializeTimestamps(data);
  
  return {
    notification: {
      title,
      body,
    },
    data: serializedData,
    tokens,
    android: {
      priority: 'high',
    },
    apns: {
      payload: {
        aps: {
          alert: {
            title,
            body,
          },
        },
      },
    },
  };
}
