// ============================================================================
// CLOUD FUNCTION: Delete Event Image on Event Deletion
// Location: functions/src/cleanup/onEventDeleted.ts
// ============================================================================

import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

export const onEventDeleted = onDocumentDeleted(
  {
    document: "events/{eventId}",
    region: "australia-southeast1",
  },
  async (event) => {
    try {
      const eventData = event.data?.data();
      const eventId = event.params.eventId;

      if (!eventData) {
        logger.warn("No event data found for deletion");
        return;
      }

      logger.info("🗑️ Event deleted, cleaning up image...", {
        eventId,
        title: eventData.title,
        hasImage: !!eventData.image_url,
      });

      // If the event had an image, delete it from Storage
      if (eventData.image_url) {
        try {
          const bucket = admin.storage().bucket();
          const imagePath = `events/${eventId}/image.jpg`;

          await bucket.file(imagePath).delete();

          logger.info("✅ Event image deleted from Storage", {
            eventId,
            imagePath,
          });
        } catch (storageError: any) {
          // If file doesn't exist, that's okay - it might have been manually deleted
          if (storageError.code === 404) {
            logger.info("⚠️ Image file not found in Storage (already deleted)", {
              eventId,
            });
          } else {
            logger.error("❌ Error deleting event image from Storage", {
              eventId,
              error: storageError.message,
            });
          }
        }
      } else {
        logger.info("ℹ️ No image to delete for this event", { eventId });
      }

    } catch (error: any) {
      logger.error("❌ Error in event deletion cleanup:", error);
    }
  }
);
