// ============================================================================
// CLOUD FUNCTION: Delete Event Image on Event Deletion
// Location: functions/src/cleanup/onEventDeleted.ts
// ============================================================================

import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { deleteFolderContents, parseStorageRef } from "../utils/imageHelpers";

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

      logger.info("🗑️ Event deleted, checking for image cleanup...", {
        eventId,
        title: eventData.title,
      });

      // Check if the event had an image
      const imageUrl: string | undefined = eventData.image_url as string | undefined;

      if (!imageUrl) {
        logger.info("ℹ️ No image to delete for this event", { eventId });
        return;
      }

      // Parse the storage reference
      const ref = parseStorageRef(imageUrl);
      
      if (!ref) {
        logger.warn("Could not parse image URL", { imageUrl });
        return;
      }

      // Only delete if it's in the events/ prefix (safety check)
      if (!ref.path.startsWith("events/")) {
        logger.info("ℹ️ Image not in events/ prefix, skipping cleanup", { 
          eventId, 
          path: ref.path 
        });
        return;
      }

      // If it's in the live/{eventId}/ folder, delete the entire folder
      if (ref.path.includes(`/live/${eventId}/`)) {
        const folderPath = `events/live/${eventId}/`;
        const deletedCount = await deleteFolderContents(folderPath, ref.bucket);
        
        logger.info("✅ Event live folder deleted", {
          eventId,
          folderPath,
          filesDeleted: deletedCount,
        });
      } else {
        logger.info("ℹ️ Image not in expected live folder, skipping", {
          eventId,
          path: ref.path,
        });
      }
    } catch (error: any) {
      logger.error("❌ Error in event deletion cleanup:", error);
    }
  }
);
