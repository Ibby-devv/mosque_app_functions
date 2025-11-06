// ============================================================================
// CLOUD FUNCTION: Handle Notification Image Changes on Update
// Location: functions/src/cleanup/onNotificationLogUpdated.ts
// ============================================================================

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { isTmpUrl, moveToLive, isLiveUrl, deleteFile } from "../utils/imageHelpers";

export const onNotificationLogUpdated = onDocumentUpdated(
  {
    document: "notificationLogs/{logId}",
    region: "australia-southeast1",
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();
    const logId = event.params.logId;

    if (!beforeData || !afterData) {
      logger.warn("Missing before/after data in notification log update");
      return;
    }

    // Extract image URLs from both data.imageUrl and top-level imageUrl
    const oldImageUrl: string | undefined =
      (beforeData.data?.imageUrl as string | undefined) ?? (beforeData.imageUrl as string | undefined);
    const newImageUrl: string | undefined =
      (afterData.data?.imageUrl as string | undefined) ?? (afterData.imageUrl as string | undefined);

    // If image URL hasn't changed, nothing to do
    if (oldImageUrl === newImageUrl) {
      return;
    }

    logger.info("📸 Notification image changed", {
      logId,
      oldUrl: oldImageUrl,
      newUrl: newImageUrl,
    });

    const db = admin.firestore();

    try {
      // Delete old image if it exists and is in the live folder for this log
      if (oldImageUrl && isLiveUrl(oldImageUrl, logId)) {
        await deleteFile(oldImageUrl);
        logger.info("✅ Old notification image deleted", { logId, oldUrl: oldImageUrl });
      }

      // Finalize new image if it's a tmp upload
      if (newImageUrl && isTmpUrl(newImageUrl)) {
        const liveUrl = await moveToLive(newImageUrl, "notifications", logId);

        if (liveUrl) {
          // Update the document with the new live URL
          const updateData: any = {};

          if (afterData.data?.imageUrl) {
            updateData["data.imageUrl"] = liveUrl;
          } else if (afterData.imageUrl) {
            updateData.imageUrl = liveUrl;
          }

          await db.collection("notificationLogs").doc(logId).update(updateData);

          logger.info("✅ New notification image finalized", {
            logId,
            tmpUrl: newImageUrl,
            liveUrl,
          });
        }
      }
    } catch (error) {
      logger.error("❌ Error handling notification image update", {
        logId,
        error,
      });
    }
  }
);
