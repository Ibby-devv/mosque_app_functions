// ============================================================================
// UTILITY: FCM Messaging Helpers
// Location: functions/src/utils/messagingHelpers.ts
// ============================================================================

import * as admin from "firebase-admin";

/**
 * Convert a Firestore Timestamp to an ISO 8601 string
 * Returns empty string if value is null/undefined
 * Returns value as-is if already a string
 */
export function timestampToString(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }
  if (typeof value === "object" && value.toDate && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return String(value);
}

/**
 * Build FCM message payload with proper configuration for data-only messages
 * 
 * IMPORTANT: For data-only messages to trigger background handlers on Android/iOS:
 * - Android: Must set priority: 'high'
 * - iOS: Must set content-available: true + proper APNs headers
 * 
 * This ensures background message handlers are invoked when app is backgrounded/quit.
 */
export function buildDataOnlyMessage(data: Record<string, string>, tokens: string[]): admin.messaging.MulticastMessage {
  return {
    data,
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
 */
export function buildNotificationMessage(
  title: string,
  body: string,
  data: Record<string, string>,
  tokens: string[]
): admin.messaging.MulticastMessage {
  return {
    notification: {
      title,
      body,
    },
    data,
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
