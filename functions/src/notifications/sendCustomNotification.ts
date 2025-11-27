// ============================================================================
// CLOUD FUNCTION: Send Custom Notification (Admin Triggered)
// Location: functions/src/notifications/sendCustomNotification.ts
// ============================================================================

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { getActiveTokens, cleanupInvalidTokens } from "../utils/tokenCleanup";
import { buildDataOnlyMessage, timestampToString } from "../utils/messagingHelpers";
import { isTmpUrl, moveToLive } from "../utils/imageHelpers";

interface SendCustomNotificationRequest {
  title: string;
  body: string;
  image_url?: string;
  data?: {
    type?: string;
    link?: string;
    [key: string]: any;
  };
}

export const sendCustomNotification = onCall(
  {
    region: "australia-southeast1",
    cors: true,
  },
  async (request) => {
    // Authentication check - only authenticated admins can send
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be authenticated to send notifications"
      );
    }

    // TODO: Add admin role check here
    // For now, any authenticated user can send
    // In production, add: if (!request.auth.token.admin) { throw error }

    const { title, body, image_url, data } = request.data as SendCustomNotificationRequest;

    // Validate inputs
    if (!title || !body) {
      throw new HttpsError(
        "invalid-argument",
        "Title and body are required"
      );
    }

    if (title.length > 100) {
      throw new HttpsError(
        "invalid-argument",
        "Title must be 100 characters or less"
      );
    }

    if (body.length > 500) {
      throw new HttpsError(
        "invalid-argument",
        "Body must be 500 characters or less"
      );
    }

    try {
      logger.info("📢 Sending custom notification...", {
        title,
        sentBy: request.auth.uid,
        hasImage: !!image_url,
      });

      // Get all active devices with notifications enabled
      // Only include tokens seen in the last 90 days
      const { tokens, deviceIds } = await getActiveTokens(90);

      if (tokens.length === 0) {
        logger.info("No active devices with notifications enabled");
        return {
          success: true,
          message: "No devices to notify",
          sentCount: 0,
        };
      }

      // Pre-create the notification log to get an ID for finalizing the image
      const logRef = await admin.firestore().collection("notificationLogs").add({
        type: data?.type || "general",
        title,
        body,
        imageUrl: image_url || "",
        data: data || {},
        sentBy: request.auth.uid,
        sentTo: tokens.length,
        successCount: 0,
        failureCount: 0,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const logId = logRef.id;
      logger.info("Created notification log", { logId });

      // Finalize image if it's in tmp
      let finalImageUrl = image_url || "";
      if (image_url && isTmpUrl(image_url)) {
        logger.info("Finalizing tmp image before sending...", { tmpUrl: image_url });
        const liveUrl = await moveToLive(image_url, "notifications", logId);
        if (liveUrl) {
          finalImageUrl = liveUrl;
          logger.info("Image finalized to live", { liveUrl });

          // Update the log with the live URL
          await logRef.update({ imageUrl: liveUrl });
        } else {
          logger.warn("Failed to finalize image, using tmp URL");
        }
      }

      // Send data-only message for consistent Notifee styling across all app states
      const notificationData = {
        type: data?.type || "general",
        title,
        body,
        imageUrl: finalImageUrl,
        link: data?.link || "",
        sentBy: request.auth.uid,
        sentAt: new Date().toISOString(),
        ...data,
      };

      // FCM requires data payload values to be strings
      const stringDataEntries = await Promise.all(
        Object.entries(notificationData).map(async ([key, value]) => [
          key,
          await timestampToString(value),
        ])
      );
      const stringData: Record<string, string> = Object.fromEntries(stringDataEntries);

      const message = buildDataOnlyMessage(stringData, tokens);

      const response = await admin.messaging().sendEachForMulticast(message);

      // Clean up invalid tokens
      await cleanupInvalidTokens(tokens, response.responses, deviceIds);

      // Update the log with final results
      await logRef.update({
        data: stringData,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });

      logger.info("✅ Custom notification sent", {
        logId,
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
        imageFinalized: image_url && isTmpUrl(image_url),
      });

      return {
        success: true,
        message: `Notification sent to ${response.successCount} users`,
        sentCount: response.successCount,
        failedCount: response.failureCount,
        totalTokens: tokens.length,
      };

    } catch (error: any) {
      logger.error("❌ Error sending custom notification:", error);
      throw new HttpsError(
        "internal",
        "Failed to send notification",
        error.message
      );
    }
  }
);
