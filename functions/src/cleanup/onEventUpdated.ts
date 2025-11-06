// ============================================================================
// CLOUD FUNCTION: Handle Event Image Changes on Update
// Location: functions/src/cleanup/onEventUpdated.ts
// ============================================================================

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { isTmpUrl, moveToLive, isLiveUrl, deleteFile } from "../utils/imageHelpers";

export const onEventUpdated = onDocumentUpdated(
  {
    document: "events/{eventId}",
    region: "australia-southeast1",
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();
    const eventId = event.params.eventId;

    if (!beforeData || !afterData) {
      logger.warn("Missing before/after data in event update");
      return;
    }

    // Extract image URLs
    const oldImageUrl: string | undefined = beforeData.image_url as string | undefined;
    const newImageUrl: string | undefined = afterData.image_url as string | undefined;

    // If image URL hasn't changed, nothing to do
    if (oldImageUrl === newImageUrl) {
      return;
    }

    logger.info("📸 Event image changed", {
      eventId,
      oldUrl: oldImageUrl,
      newUrl: newImageUrl,
    });

    const db = admin.firestore();

    try {
      // Delete old image if it exists and is in the live folder for this event
      if (oldImageUrl && isLiveUrl(oldImageUrl, eventId)) {
        await deleteFile(oldImageUrl);
        logger.info("✅ Old event image deleted", { eventId, oldUrl: oldImageUrl });
      }

      // Finalize new image if it's a tmp upload
      if (newImageUrl && isTmpUrl(newImageUrl)) {
        const liveUrl = await moveToLive(newImageUrl, "events", eventId);

        if (liveUrl) {
          // Update the document with the new live URL
          await db.collection("events").doc(eventId).update({
            image_url: liveUrl,
          });

          logger.info("✅ New event image finalized", {
            eventId,
            tmpUrl: newImageUrl,
            liveUrl,
          });
        }
      }
    } catch (error) {
      logger.error("❌ Error handling event image update", {
        eventId,
        error,
      });
    }
  }
);
