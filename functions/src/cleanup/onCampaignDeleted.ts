// ============================================================================
// CLOUD FUNCTION: Delete Campaign Image on Campaign Deletion
// Location: functions/src/cleanup/onCampaignDeleted.ts
// ============================================================================

import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";

export const onCampaignDeleted = onDocumentDeleted(
  {
    document: "campaigns/{campaignId}",
    region: "australia-southeast1",
  },
  async (event) => {
    try {
      const campaignData = event.data?.data();
      const campaignId = event.params.campaignId;

      if (!campaignData) {
        logger.warn("No campaign data found for deletion");
        return;
      }

      logger.info("🗑️ Campaign deleted, cleaning up image...", {
        campaignId,
        title: campaignData.title,
        hasImage: !!campaignData.image_url,
      });

      // If the campaign had an image, delete it from Storage
      if (campaignData.image_url) {
        try {
          const bucket = admin.storage().bucket();
          const imagePath = `campaigns/${campaignId}/image.jpg`;

          await bucket.file(imagePath).delete();

          logger.info("✅ Campaign image deleted from Storage", {
            campaignId,
            imagePath,
          });
        } catch (storageError: any) {
          // If file doesn't exist, that's okay - it might have been manually deleted
          if (storageError.code === 404) {
            logger.info("⚠️ Image file not found in Storage (already deleted)", {
              campaignId,
            });
          } else {
            logger.error("❌ Error deleting campaign image from Storage", {
              campaignId,
              error: storageError.message,
            });
          }
        }
      } else {
        logger.info("ℹ️ No image to delete for this campaign", { campaignId });
      }

    } catch (error: any) {
      logger.error("❌ Error in campaign deletion cleanup:", error);
    }
  }
);
