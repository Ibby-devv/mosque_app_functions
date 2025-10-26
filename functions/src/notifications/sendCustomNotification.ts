// ============================================================================
// CLOUD FUNCTION: Send Custom Notification (Admin Triggered)
// Location: functions/src/notifications/sendCustomNotification.ts
// ============================================================================

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

interface SendCustomNotificationRequest {
  title: string;
  body: string;
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

    const { title, body, data } = request.data as SendCustomNotificationRequest;

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
      });

      // Get all users with notifications enabled
      const usersSnapshot = await admin.firestore()
        .collection("users")
        .where("notificationsEnabled", "==", true)
        .get();

      if (usersSnapshot.empty) {
        logger.info("No users with notifications enabled");
        return {
          success: true,
          message: "No users to notify",
          sentCount: 0,
        };
      }

      // Collect FCM tokens
      const tokens: string[] = [];
      usersSnapshot.forEach((doc) => {
        const userData = doc.data();
        if (userData.fcmToken) {
          tokens.push(userData.fcmToken);
        }
      });

      if (tokens.length === 0) {
        logger.info("No FCM tokens found");
        return {
          success: true,
          message: "No valid tokens to send to",
          sentCount: 0,
        };
      }

      // Prepare notification data
      const notificationData = {
        type: data?.type || "announcement",
        link: data?.link || "",
        sentBy: request.auth.uid,
        sentAt: new Date().toISOString(),
        ...data,
      };

      // Send notification to all tokens
      const message = {
        notification: {
          title,
          body,
        },
        data: notificationData,
        tokens: tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      // Log the notification to Firestore for tracking
      await admin.firestore().collection("notificationLogs").add({
        type: "custom",
        title,
        body,
        data: notificationData,
        sentBy: request.auth.uid,
        sentTo: tokens.length,
        successCount: response.successCount,
        failureCount: response.failureCount,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info("✅ Custom notification sent", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
      });

      // Log failures
      if (response.failureCount > 0) {
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            logger.warn("Failed to send to token", {
              token: tokens[idx].substring(0, 20) + "...",
              error: resp.error?.message,
            });
          }
        });
      }

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
