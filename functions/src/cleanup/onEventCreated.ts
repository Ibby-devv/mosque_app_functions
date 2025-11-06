// ============================================================================
// CLOUD FUNCTION: Finalize Event Image on Creation
// Location: functions/src/cleanup/onEventCreated.ts
// ============================================================================

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { isTmpUrl, moveToLive } from "../utils/imageHelpers";

export const onEventCreated = onDocumentCreated(
  {
    document: "events/{eventId}",
    region: "australia-southeast1",
  },
  async (event) => {
    const eventData = event.data?.data();
    const eventId = event.params.eventId;

    if (!eventData) {
      logger.warn("No event data found");
      return;
    }

    logger.info("📸 Event created, checking for image finalization...", {
      eventId,
      title: eventData.title,
    });

    // Check for image_url field
    const imageUrl: string | undefined = eventData.image_url as string | undefined;

    if (!imageUrl) {
      logger.info("ℹ️ No image URL in event");
      return;
    }

    // Only finalize if it's a tmp upload
    if (!isTmpUrl(imageUrl)) {
      logger.info("ℹ️ Image already in live location or external URL", { imageUrl });
      return;
    }

    try {
      // Move from tmp to live
      const liveUrl = await moveToLive(imageUrl, "events", eventId);

      if (!liveUrl) {
        logger.error("Failed to move image to live location", { imageUrl, eventId });
        return;
      }

      // Update the document with the new live URL
      const db = admin.firestore();
      await db.collection("events").doc(eventId).update({
        image_url: liveUrl,
      });

      logger.info("✅ Event image finalized", {
        eventId,
        oldUrl: imageUrl,
        newUrl: liveUrl,
      });
    } catch (error) {
      logger.error("❌ Error finalizing event image", {
        eventId,
        imageUrl,
        error,
      });
    }
  }
);
