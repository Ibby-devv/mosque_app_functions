/**
 * onCampaignDeleted
 * 
 * Triggered when a campaign document is deleted.
 * Cleans up all images in campaigns/live/{campaignId}/
 */

import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { parseStorageRef, deleteFolderContents } from '../utils/imageHelpers';

export const onCampaignDeleted = onDocumentDeleted(
  'campaigns/{campaignId}',
  async (event) => {
    const campaignId = event.params.campaignId;
    const data = event.data?.data();

    logger.info(`Campaign ${campaignId}: Cleaning up images...`);

    try {
      const imageUrl = data?.image_url;

      if (imageUrl) {
        // Parse the URL to get bucket and path
        const parsed = parseStorageRef(imageUrl);

        // Delete entire live folder for this campaign
        const folderPath = `campaigns/live/${campaignId}/`;
        await deleteFolderContents(folderPath, parsed?.bucket);

        logger.info(`Campaign ${campaignId}: Images cleaned up successfully`, {
          folder: folderPath,
        });
      } else {
        logger.info(`Campaign ${campaignId}: No images to clean up`);
      }
    } catch (error) {
      logger.error(`Campaign ${campaignId}: Error cleaning up images`, {
        error,
        imageUrl: data?.image_url,
      });
      // Don't throw - deletion should succeed even if cleanup fails
    }
  }
);
