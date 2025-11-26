// ============================================================================
// UTILITY: FCM Messaging Helpers
// Location: functions/src/utils/messagingHelpers.ts
// ============================================================================

import * as admin from "firebase-admin";

// Cache for mosque timezone setting
let cachedMosqueTimezone: string | null = null;

/**
 * Get mosque timezone from Firestore settings (with caching)
 * Falls back to Australia/Sydney if not configured
 */
async function getMosqueTimezone(): Promise<string> {
  if (cachedMosqueTimezone) {
    return cachedMosqueTimezone;
  }

  try {
    const db = admin.firestore();
    const settingsDoc = await db.collection('mosqueSettings').doc('info').get();
    const timezone = settingsDoc.data()?.timezone;
    
    if (timezone && typeof timezone === 'string') {
      cachedMosqueTimezone = timezone;
      return timezone;
    }
  } catch (error) {
    console.warn('Could not fetch mosque timezone, using default:', error);
  }

  // Default fallback
  cachedMosqueTimezone = 'Australia/Sydney';
  return cachedMosqueTimezone;
}

/**
 * Convert a Firestore Timestamp to DD/MM/YYYY HH:MM format in mosque timezone
 * Returns empty string if value is null/undefined
 * Returns value as-is if already a string
 */
export async function timestampToString(value: any): Promise<string> {
  if (!value) return "";
  if (typeof value === "string") return value;
  
  let date: Date;
  
  if (value instanceof admin.firestore.Timestamp) {
    date = value.toDate();
  } else if (typeof value === "object" && value.toDate && typeof value.toDate === "function") {
    date = value.toDate();
  } else {
    return String(value);
  }
  
  // Get mosque timezone from settings
  const mosqueTimezone = await getMosqueTimezone();
  
  // Format as DD/MM/YYYY HH:MM in mosque timezone
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: mosqueTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = formatter.formatToParts(date);
  const day = parts.find(p => p.type === 'day')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const year = parts.find(p => p.type === 'year')?.value || '';
  const hour = parts.find(p => p.type === 'hour')?.value || '';
  const minute = parts.find(p => p.type === 'minute')?.value || '';
  
  return `${day}/${month}/${year} ${hour}:${minute}`;
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
