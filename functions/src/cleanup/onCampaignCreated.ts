/**
 * onCampaignCreated
 * 
 * Triggered when a new campaign document is created.
 * Finalizes temporary images by moving them from campaigns/tmp/ to campaigns/live/{campaignId}/
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { getFirestore } from 'firebase-admin/firestore';
import { isTmpUrl, moveToLive } from '../utils/imageHelpers';

export const onCampaignCreated = onDocumentCreated(
  'campaigns/{campaignId}',
  async (event) => {
    const campaignId = event.params.campaignId;
    const data = event.data?.data();

    if (!data) {
      logger.warn(`No data found for campaign ${campaignId}`);
      return;
    }

    const imageUrl = data.image_url;

    // Only process if image_url exists and is in tmp
    if (!imageUrl || !isTmpUrl(imageUrl)) {
      logger.info(`Campaign ${campaignId}: No tmp image to finalize`);
      return;
    }

    try {
      logger.info(`Campaign ${campaignId}: Finalizing tmp image to live...`);

      // Move from campaigns/tmp/{uuid}.ext to campaigns/live/{campaignId}/{filename}
      const liveUrl = await moveToLive(imageUrl, 'campaigns', campaignId);

      // Update the campaign document with the live URL
      const db = getFirestore();
      await db.collection('campaigns').doc(campaignId).update({
        image_url: liveUrl,
      });

      logger.info(`Campaign ${campaignId}: Image finalized successfully`, {
        tmpUrl: imageUrl,
        liveUrl,
      });
    } catch (error) {
      logger.error(`Campaign ${campaignId}: Error finalizing image`, {
        error,
        imageUrl,
      });
      // Don't throw - let the campaign exist even if image finalization fails
    }
  }
);
