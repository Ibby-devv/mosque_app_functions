// ============================================================================
// UTILITY: Token Cleanup Helper
// Location: functions/src/utils/tokenCleanup.ts
// ============================================================================

import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

/**
 * Process FCM send responses and clean up invalid tokens
 * 
 * Best practices for token management:
 * 1. Remove tokens that are invalid or unregistered
 * 2. Keep track of failed deliveries
 * 3. Update lastSeen for successful deliveries
 */
export async function cleanupInvalidTokens(
  tokens: string[],
  responses: any[],
  deviceIds?: string[]
): Promise<void> {
  const batch = admin.firestore().batch();
  let cleanupCount = 0;

  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];
    const token = tokens[i];

    if (!response.success && response.error) {
      const errorCode = response.error.code;

      // Check if the error indicates an invalid/unregistered token
      if (
        errorCode === "messaging/invalid-registration-token" ||
        errorCode === "messaging/registration-token-not-registered" ||
        errorCode === "messaging/invalid-argument"
      ) {
        logger.warn("Removing invalid token", {
          token: token.substring(0, 20) + "...",
          errorCode,
        });

        // If we have device IDs, use them to find the document
        if (deviceIds && deviceIds[i]) {
          const docRef = admin.firestore()
            .collection("fcmTokens")
            .doc(deviceIds[i]);
          
          batch.delete(docRef);
          cleanupCount++;
        } else {
          // Otherwise, query by token (less efficient but works)
          const snapshot = await admin.firestore()
            .collection("fcmTokens")
            .where("fcmToken", "==", token)
            .limit(1)
            .get();

          if (!snapshot.empty) {
            snapshot.forEach((doc) => {
              batch.delete(doc.ref);
              cleanupCount++;
            });
          }
        }
      }
    }
  }

  if (cleanupCount > 0) {
    await batch.commit();
    logger.info(`🧹 Cleaned up ${cleanupCount} invalid tokens`);
  }
}

/**
 * Get active FCM tokens (with notifications enabled and valid tokens)
 * 
 * @param maxAgeDays - Optional: Only return tokens seen within this many days
 * @returns Object containing tokens and their corresponding device IDs
 */
export async function getActiveTokens(maxAgeDays?: number): Promise<{
  tokens: string[];
  deviceIds: string[];
}> {
  let query = admin.firestore()
    .collection("fcmTokens")
    .where("notificationsEnabled", "==", true);

  // Optionally filter by lastSeen date to exclude stale tokens
  if (maxAgeDays) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    
    query = query.where("lastSeen", ">=", admin.firestore.Timestamp.fromDate(cutoffDate));
  }

  const snapshot = await query.get();

  const tokens: string[] = [];
  const deviceIds: string[] = [];

  snapshot.forEach((doc) => {
    const tokenData = doc.data();
    if (tokenData.fcmToken) {
      tokens.push(tokenData.fcmToken);
      deviceIds.push(doc.id);
    }
  });

  return { tokens, deviceIds };
}
