// ============================================================================
// CLOUD FUNCTION: Delete Notification Image on Log Deletion
// Location: functions/src/cleanup/onNotificationLogDeleted.ts
// ============================================================================

import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

export const onNotificationLogDeleted = onDocumentDeleted(
  {
    document: "notificationLogs/{logId}",
    region: "australia-southeast1",
  },
  async (event) => {
    try {
      const logData = event.data?.data();
      const logId = event.params.logId;

      if (!logData) {
        logger.warn("No notification log data found for deletion");
        return;
      }

      logger.info("🗑️ Notification log deleted, checking for image cleanup...", {
        logId,
        title: logData.title,
      });

      // Check if the notification had an image
      const imageUrl = logData.data?.imageUrl || logData.imageUrl;

      if (imageUrl && typeof imageUrl === 'string' && (imageUrl.includes('notifications/') || imageUrl.includes('notifications%2F'))) {
        try {
          // Extract the storage path from the URL
          // URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?{params}
          const urlParts = imageUrl.split('/o/')[1];
          if (urlParts) {
            const storagePath = decodeURIComponent(urlParts.split('?')[0]);

            const bucket = admin.storage().bucket();
            await bucket.file(storagePath).delete();

            logger.info("✅ Notification image deleted from Storage", {
              logId,
              storagePath,
            });
          }
        } catch (storageError: any) {
          // If file doesn't exist, that's okay - it might have been manually deleted
          if (storageError.code === 404) {
            logger.info("⚠️ Image file not found in Storage (already deleted)", {
              logId,
            });
          } else {
            logger.error("❌ Error deleting notification image from Storage", {
              logId,
              error: storageError.message,
            });
          }
        }
      } else {
        logger.info("ℹ️ No image to delete for this notification", { logId });
      }

    } catch (error: any) {
      logger.error("❌ Error in notification log deletion cleanup:", error);
    }
  }
);
