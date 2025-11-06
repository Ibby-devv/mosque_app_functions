// ============================================================================
// CLOUD FUNCTION: Finalize Notification Image on Log Creation
// Location: functions/src/cleanup/onNotificationLogCreated.ts
// ============================================================================

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { isTmpUrl, moveToLive } from "../utils/imageHelpers";

export const onNotificationLogCreated = onDocumentCreated(
  {
    document: "notificationLogs/{logId}",
    region: "australia-southeast1",
  },
  async (event) => {
    const logData = event.data?.data();
    const logId = event.params.logId;

    if (!logData) {
      logger.warn("No notification log data found");
      return;
    }

    logger.info("📸 Notification log created, checking for image finalization...", {
      logId,
      title: logData.title,
    });

    // Check for image URL in data.imageUrl or top-level imageUrl
    const imageUrl: string | undefined =
      (logData.data?.imageUrl as string | undefined) ?? (logData.imageUrl as string | undefined);

    if (!imageUrl) {
      logger.info("ℹ️ No image URL in notification log");
      return;
    }

    // Only finalize if it's a tmp upload
    if (!isTmpUrl(imageUrl)) {
      logger.info("ℹ️ Image already in live location or external URL", { imageUrl });
      return;
    }

    try {
      // Move from tmp to live
      const liveUrl = await moveToLive(imageUrl, "notifications", logId);

      if (!liveUrl) {
        logger.error("Failed to move image to live location", { imageUrl, logId });
        return;
      }

      // Update the document with the new live URL
      const db = admin.firestore();
      const updateData: any = {};

      if (logData.data?.imageUrl) {
        updateData["data.imageUrl"] = liveUrl;
      } else if (logData.imageUrl) {
        updateData.imageUrl = liveUrl;
      }

      await db.collection("notificationLogs").doc(logId).update(updateData);

      logger.info("✅ Notification image finalized", {
        logId,
        oldUrl: imageUrl,
        newUrl: liveUrl,
      });
    } catch (error) {
      logger.error("❌ Error finalizing notification image", {
        logId,
        imageUrl,
        error,
      });
    }
  }
);
