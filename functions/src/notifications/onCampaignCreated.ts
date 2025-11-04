// ============================================================================
// CLOUD FUNCTION: Send Notification on Campaign Created
// Location: functions/src/notifications/onCampaignCreated.ts
// ============================================================================

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { getActiveTokens, cleanupInvalidTokens } from "../utils/tokenCleanup";
import { buildDataOnlyMessage } from "../utils/messagingHelpers";

export const onCampaignCreated = onDocumentCreated(
  {
    document: "campaigns/{campaignId}",
    region: "australia-southeast1",
  },
  async (event) => {
    try {
      const campaignData = event.data?.data();
      
      if (!campaignData) {
        logger.error("No campaign data found");
        return;
      }

      logger.info("💚 New campaign created, sending notifications...", {
        campaignId: event.params.campaignId,
        title: campaignData.title,
      });

      // Get all active devices with notifications enabled
      const { tokens, deviceIds } = await getActiveTokens(90);

      if (tokens.length === 0) {
        logger.info("No active devices with notifications enabled");
        return;
      }

      // Format goal amount if available
      const goalAmount = campaignData.goal_amount;
      const goalStr = goalAmount 
        ? ` - Goal: $${(goalAmount / 100).toFixed(0)}`
        : "";

      // Send notification to all tokens
      // NOTE: Sending data-only message (no notification field) so the app
      // can handle display with custom styling based on type
      const messageData = {
        type: "campaign",
        campaignId: event.params.campaignId,
        title: "💚 New Donation Campaign",
        body: `${campaignData.title}${goalStr}`,
        campaignTitle: campaignData.title || "",
        goalAmount: goalAmount?.toString() || "0",
        imageUrl: campaignData.image_url || "",
      };

      const message = buildDataOnlyMessage(messageData, tokens);

      const response = await admin.messaging().sendEachForMulticast(message);

      // Clean up invalid tokens
      await cleanupInvalidTokens(tokens, response.responses, deviceIds);

      logger.info("✅ Campaign notifications sent", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        totalTokens: tokens.length,
      });

    } catch (error: any) {
      logger.error("❌ Error sending campaign notifications:", error);
    }
  }
);
