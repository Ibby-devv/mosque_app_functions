// ============================================================================
// CLOUD FUNCTION: Delete Notification Image on Log Deletion
// Location: functions/src/cleanup/onNotificationLogDeleted.ts
// ============================================================================

import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { deleteFolderContents, parseStorageRef } from "../utils/imageHelpers";

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
      const imageUrl: string | undefined =
        (logData.data?.imageUrl as string | undefined) ?? (logData.imageUrl as string | undefined);

      if (!imageUrl) {
        logger.info("ℹ️ No image to delete for this notification", { logId });
        return;
      }

      // Parse the storage reference
      const ref = parseStorageRef(imageUrl);
      
      if (!ref) {
        logger.warn("Could not parse image URL", { imageUrl });
        return;
      }

      // Only delete if it's in the notifications/ prefix (safety check)
      if (!ref.path.startsWith("notifications/")) {
        logger.info("ℹ️ Image not in notifications/ prefix, skipping cleanup", { 
          logId, 
          path: ref.path 
        });
        return;
      }

      // If it's in the live/{logId}/ folder, delete the entire folder
      if (ref.path.includes(`/live/${logId}/`)) {
        const folderPath = `notifications/live/${logId}/`;
        const deletedCount = await deleteFolderContents(folderPath, ref.bucket);
        
        logger.info("✅ Notification live folder deleted", {
          logId,
          folderPath,
          filesDeleted: deletedCount,
        });
      } else {
        logger.info("ℹ️ Image not in expected live folder, skipping", {
          logId,
          path: ref.path,
        });
      }
    } catch (error: any) {
      logger.error("❌ Error in notification log deletion cleanup:", error);
    }
  }
);
