/**
 * onCampaignUpdated
 * 
 * Triggered when a campaign document is updated.
 * Handles image changes:
 * - If old image was in live/{campaignId}/, delete it
 * - If new image is in tmp/, finalize it to live/{campaignId}/
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { getFirestore } from 'firebase-admin/firestore';
import { isTmpUrl, isLiveUrl, moveToLive, deleteFile } from '../utils/imageHelpers';

export const onCampaignUpdated = onDocumentUpdated(
  'campaigns/{campaignId}',
  async (event) => {
    const campaignId = event.params.campaignId;
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      logger.warn(`Missing data for campaign update ${campaignId}`);
      return;
    }

    const oldImageUrl = beforeData.image_url;
    const newImageUrl = afterData.image_url;

    // No image change
    if (oldImageUrl === newImageUrl) {
      return;
    }

    try {
      // If old image exists and is in live/{campaignId}/, delete it
      if (oldImageUrl && isLiveUrl(oldImageUrl, campaignId)) {
        logger.info(`Campaign ${campaignId}: Deleting old live image...`);
        await deleteFile(oldImageUrl);
        logger.info(`Campaign ${campaignId}: Old image deleted`, { oldImageUrl });
      }

      // If new image is in tmp, finalize it to live
      if (newImageUrl && isTmpUrl(newImageUrl)) {
        logger.info(`Campaign ${campaignId}: Finalizing new tmp image...`);
        const liveUrl = await moveToLive(newImageUrl, 'campaigns', campaignId);

        // Update document with live URL
        const db = getFirestore();
        await db.collection('campaigns').doc(campaignId).update({
          image_url: liveUrl,
        });

        logger.info(`Campaign ${campaignId}: New image finalized`, {
          tmpUrl: newImageUrl,
          liveUrl,
        });
      }
    } catch (error) {
      logger.error(`Campaign ${campaignId}: Error handling image update`, {
        error,
        oldImageUrl,
        newImageUrl,
      });
      // Don't throw - let the update succeed even if image handling fails
    }
  }
);
